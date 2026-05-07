/**
 * Pure-function helper that merges a validated `GroupPatch` into an existing
 * `RegisteredGroup`. Extracted from `src/routes/groups.ts` so the merge logic
 * can be unit-tested without bootstrapping Hono / DB.
 *
 * The route layer is still responsible for permission checks, schema
 * validation, name normalization, and writing to DB. This file only owns
 * the "given a validated patch, what does the new group look like" question.
 *
 * Why pull this out now: a `cursor_model`-only PATCH used to silently no-op
 * because the route's "anything to update?" gate didn't include the field
 * (P0-1 in the 2026-05-06 review). The new test suite (group-patch-merge.test.ts)
 * pins that exact regression so the gate stays in sync with the field set.
 */
import type { ExecutionMode, RegisteredGroup, Runtime } from './types.js';

/** Subset of GroupPatchSchema that this merger consumes. Mirrors the zod
 * schema's nullable/optional shape; extending the schema requires extending
 * this type *and* the merge function below in lockstep. */
export interface GroupPatch {
  /** Already normalized via `normalizeGroupName` at the route layer. */
  name?: string;
  activation_mode?:
    | 'auto'
    | 'always'
    | 'when_mentioned'
    | 'owner_mentioned'
    | 'disabled';
  execution_mode?: ExecutionMode;
  /** `null` = clear group override → fall back to `user.default_runtime`. */
  runtime?: Runtime | null;
  /** `null` = clear group override → fall back to `user.cursor_model` →
   * env `CURSOR_MODEL` → hard-coded default. */
  cursor_model?: string | null;
}

/**
 * Whether the patch carries any persisted change. The route layer uses this
 * to decide whether to call `setRegisteredGroup` / `updateChatName` at all.
 *
 * Important invariant: every field in `GroupPatch` MUST be checked here.
 * Forgetting to add a field caused P0-1 (cursor_model PATCH silently 200'd
 * without writing to DB). The test suite enforces that adding a non-listed
 * field to the type breaks the test.
 */
export function patchHasChanges(patch: GroupPatch): boolean {
  return (
    !!patch.name ||
    patch.activation_mode !== undefined ||
    patch.execution_mode !== undefined ||
    patch.runtime !== undefined ||
    patch.cursor_model !== undefined
  );
}

/**
 * Merge a validated patch into an existing RegisteredGroup. Returns the new
 * full RegisteredGroup ready for `setRegisteredGroup`.
 *
 * Field semantics:
 * - `undefined` = "unchanged" — keep existing
 * - `null` (only on `runtime` / `cursor_model`) = "clear override" — store NULL
 * - any other value = "set new value"
 */
export function mergeGroupPatch(
  existing: RegisteredGroup,
  patch: GroupPatch,
): RegisteredGroup {
  return {
    name: patch.name || existing.name,
    folder: existing.folder,
    added_at: existing.added_at,
    containerConfig: existing.containerConfig,
    executionMode:
      patch.execution_mode !== undefined
        ? patch.execution_mode
        : existing.executionMode,
    customCwd: existing.customCwd,
    initSourcePath: existing.initSourcePath,
    initGitUrl: existing.initGitUrl,
    created_by: existing.created_by,
    is_home: existing.is_home,
    target_agent_id: existing.target_agent_id,
    target_main_jid: existing.target_main_jid,
    reply_policy: existing.reply_policy,
    require_mention: existing.require_mention,
    activation_mode:
      patch.activation_mode !== undefined
        ? patch.activation_mode
        : existing.activation_mode,
    runtime:
      patch.runtime !== undefined ? patch.runtime : existing.runtime,
    cursor_model:
      patch.cursor_model !== undefined
        ? patch.cursor_model
        : existing.cursor_model,
  };
}
