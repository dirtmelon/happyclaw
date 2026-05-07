/**
 * Runtime-aware session resume id helpers, extracted from `src/index.ts` so
 * the routing logic can be unit-tested without bootstrapping the whole
 * happyclaw service.
 *
 * Two responsibilities:
 *   - `runtimeForGroup(group)` — resolves the effective runtime by combining
 *     the group's override with the owner's default (DB lookup for owner).
 *   - `getResumeId(group, agentId?)` — returns the resume id stored in the
 *     correct DB column based on the resolved runtime: `cursor_chat_id` for
 *     cursor groups, `session_id` for claude groups.
 *
 * **Why this matters (P0-2 history)**: Before this extraction, `runAgent`
 * read the in-memory `sessions[folder]` cache directly, which lagged behind
 * runtime PATCH'es and led to passing claude SDK tokens to cursor-agent and
 * vice versa. Now every spawn path reads through `getResumeId` so the value
 * always reflects the current resolved runtime, even mid-session toggle.
 *
 * **Sister write-side helper**: `recordResumeId` lives in `src/index.ts`
 * because it also keeps the legacy in-memory `sessions[folder]` cache in
 * sync. That cache is no longer read on the spawn path (this module's job)
 * but is still used as a "session was reset" marker by other code paths
 * inside index.ts. Once that vestige is cleaned up, `recordResumeId` can
 * move here too.
 */
import {
  getSession,
  getSessionCursorChatId,
  getUserById,
} from './db.js';
import { resolveGroupRuntime } from './runtime-resolver.js';
import type { RegisteredGroup, Runtime } from './types.js';

/**
 * Resolve the runtime for a group, including the owner lookup. Falls back to
 * the `claude` default when the owner is missing — the resolver itself
 * enforces that policy, so callers don't need to special-case it.
 *
 * Hits the DB once per call to look up the owner. Callers in hot paths can
 * batch by computing this once and passing the runtime around.
 */
export function runtimeForGroup(group: RegisteredGroup): Runtime {
  const owner = group.created_by ? getUserById(group.created_by) : null;
  return resolveGroupRuntime(group, owner);
}

/**
 * Read the runtime-aware resume id for a group's main agent (when `agentId`
 * is null/undefined/empty) or sub-agent (when `agentId` is set).
 *
 * Used at the top of every spawn path (`runAgent` for main, the conversation
 * agent loop for sub-agents) to seed `ContainerInput.sessionId` so the
 * spawned runner can call `cursor-agent --resume <chatId>` or
 * `query({ resume: sessionId })` correctly.
 *
 * Returns `undefined` when no resume id has been stored yet on the chosen
 * column (e.g. brand-new group, or first turn after a runtime switch where
 * the new backend has never run before). Callers should treat undefined as
 * "start a fresh session".
 */
export function getResumeId(
  group: RegisteredGroup,
  agentId?: string | null,
): string | undefined {
  return runtimeForGroup(group) === 'cursor'
    ? getSessionCursorChatId(group.folder, agentId)
    : getSession(group.folder, agentId);
}
