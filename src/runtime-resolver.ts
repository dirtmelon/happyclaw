/**
 * Runtime resolution: pick the agent backend for a registered group.
 *
 * Decision order (per Step 2 of the dual-runtime plan):
 *   1. Group-level override (`RegisteredGroup.runtime`) when set.
 *   2. Group owner's `User.default_runtime` when the user record is available.
 *   3. Hard-coded `DEFAULT_RUNTIME` ('claude') as the final fallback.
 *
 * Step 4 will hook this into `container-runner.ts` to pick between
 * `agent-runner` (Claude path) and `cursor-runner` (Cursor path) when
 * spawning. Step 6 wires the per-user / per-group selectors in the Web UI.
 *
 * Pure function — no DB access. Callers fetch the user separately so they
 * can batch lookups and avoid redundant queries.
 */
import type { RegisteredGroup, Runtime, User } from './types.js';
import { DEFAULT_RUNTIME } from './types.js';

export function resolveGroupRuntime(
  group: Pick<RegisteredGroup, 'runtime'> | undefined | null,
  owner: Pick<User, 'default_runtime'> | undefined | null,
): Runtime {
  const groupRuntime = group?.runtime;
  if (groupRuntime === 'claude' || groupRuntime === 'cursor') {
    return groupRuntime;
  }
  const userDefault = owner?.default_runtime;
  if (userDefault === 'claude' || userDefault === 'cursor') {
    return userDefault;
  }
  return DEFAULT_RUNTIME;
}

/**
 * Convenience overload that takes a raw runtime string (e.g. an environment
 * variable override) and validates it. Returns null when the input is not a
 * valid runtime — callers can chain with `??` to fall back to the resolved
 * group/user runtime.
 */
export function parseRuntimeStrict(value: unknown): Runtime | null {
  if (value === 'claude' || value === 'cursor') return value;
  return null;
}
