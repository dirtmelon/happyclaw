/**
 * Resolve the effective Cursor model ID for a registered group.
 *
 * Decision chain (first non-null/non-empty wins):
 *   1. Group-level override          (`RegisteredGroup.cursor_model`)
 *   2. Group owner's user default    (`User.cursor_model`)
 *   3. Process env                   (`CURSOR_MODEL`)
 *   4. Hard-coded default            (`HARDCODED_DEFAULT_CURSOR_MODEL`)
 *
 * Pure function — no DB, no FS. Callers fetch the user separately so they
 * can batch lookups (mirrors `resolveGroupRuntime`'s style).
 *
 * Why no validation against the dynamic Cursor `--list-models` here:
 *   - This resolver runs in hot paths (every cursor-runner spawn). We can't
 *     spawn a subprocess on every call.
 *   - Stale model IDs (Cursor renames a model between subscription windows)
 *     would otherwise break spawn entirely. By passing the stored value
 *     through unchanged, we let cursor-agent itself reject the model with a
 *     clear "model not available" error, which is more debuggable.
 *   - Allowed-list validation happens at the route layer (where users pick
 *     from the dropdown / `/model` command — the surface the user sees) and
 *     in the model-list cache that the dropdown reads.
 */
import type { RegisteredGroup, User } from './types.js';

/**
 * Hard-coded final fallback. Picked per operator requirement (Opus 4.7 1M Max
 * Thinking). Cursor's name uses dashes for the version (`4-7`) but dots for
 * the family revision in other models (`4.6-sonnet-medium`) — this constant
 * ships the exact ID accepted by `cursor-agent --model`.
 *
 * Operators who want a different default without touching code should set
 * `CURSOR_MODEL` in the happyclaw service env; the resolver will pick that up
 * before falling back to this constant.
 */
export const HARDCODED_DEFAULT_CURSOR_MODEL = 'claude-opus-4-7-thinking-max';

/** Pull the resolver's view of `process.env.CURSOR_MODEL`. Indirected so
 * tests can stub it without `process.env` mutation side effects. Reuses
 * `sanitize` so empty/whitespace handling is identical across all four
 * resolution chain levels (group → user → env → default). */
export function envCursorModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return sanitize(env.CURSOR_MODEL);
}

/**
 * Determine the cursor-agent `--model` value for a group.
 *
 * `group` and `owner` are typed with `Pick` so callers can pass partial
 * objects (e.g. when only `cursor_model` was selected from a join). Both
 * `null` and `undefined` are accepted for missing values.
 *
 * Empty strings are treated as "unset" — the column allows NULL but legacy
 * imports occasionally produce empty strings, which we want to ignore.
 */
export function resolveCursorModel(
  group: Pick<RegisteredGroup, 'cursor_model'> | null | undefined,
  owner: Pick<User, 'cursor_model'> | null | undefined,
  envOverride?: string | undefined,
): string {
  const groupModel = sanitize(group?.cursor_model ?? null);
  if (groupModel) return groupModel;

  const userModel = sanitize(owner?.cursor_model ?? null);
  if (userModel) return userModel;

  const envModel = envOverride !== undefined ? sanitize(envOverride) : envCursorModel();
  if (envModel) return envModel;

  return HARDCODED_DEFAULT_CURSOR_MODEL;
}

function sanitize(raw: string | null | undefined): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
