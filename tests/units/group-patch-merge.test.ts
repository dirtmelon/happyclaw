/**
 * Regression test for the cursor_model PATCH gate (P0-1, 2026-05-06 review).
 *
 * Pins three properties of `src/group-patch-merge.ts`:
 *   1. `patchHasChanges` returns true for *every* field a user can set,
 *      including `cursor_model` alone (the original P0 was that this slipped
 *      out of the gate, so a `cursor_model`-only PATCH silently 200'd).
 *   2. `mergeGroupPatch` writes through every changed field and preserves
 *      every unchanged field, with the special `null = clear override` rule
 *      for `runtime` and `cursor_model` honored.
 *   3. The merge is pure / order-independent — applying the same patch to
 *      the same input always yields the same output.
 */
import { describe, expect, test } from 'vitest';

import {
  type GroupPatch,
  mergeGroupPatch,
  patchHasChanges,
} from '../../src/group-patch-merge';
import type { RegisteredGroup } from '../../src/types';

function baseGroup(overrides: Partial<RegisteredGroup> = {}): RegisteredGroup {
  return {
    name: 'My workspace',
    folder: 'main',
    added_at: '2026-05-01T00:00:00.000Z',
    executionMode: 'host',
    is_home: true,
    activation_mode: 'auto',
    runtime: undefined, // follow user default
    cursor_model: undefined, // follow user default → env → hard default
    ...overrides,
  };
}

describe('patchHasChanges — gate must include every persisted field', () => {
  test('empty patch → no change', () => {
    expect(patchHasChanges({})).toBe(false);
  });

  test('name-only patch → change', () => {
    expect(patchHasChanges({ name: 'New name' })).toBe(true);
  });

  test('activation_mode-only patch → change', () => {
    expect(patchHasChanges({ activation_mode: 'always' })).toBe(true);
  });

  test('execution_mode-only patch → change', () => {
    expect(patchHasChanges({ execution_mode: 'host' })).toBe(true);
  });

  test('runtime-only patch (pin) → change', () => {
    expect(patchHasChanges({ runtime: 'cursor' })).toBe(true);
  });

  test('runtime-only patch (clear with null) → change', () => {
    expect(patchHasChanges({ runtime: null })).toBe(true);
  });

  // ── The original P0-1 regression cases ──
  test('cursor_model-only patch (pin) → change (REGRESSION: was silently dropped)', () => {
    expect(patchHasChanges({ cursor_model: 'composer-2-fast' })).toBe(true);
  });

  test('cursor_model-only patch (clear with null) → change (REGRESSION)', () => {
    expect(patchHasChanges({ cursor_model: null })).toBe(true);
  });

  test('GroupPatch type forbids unknown fields at compile time', () => {
    // Real type-level pin: if the GroupPatch type ever loosens to allow
    // arbitrary keys (e.g. via index signature), this @ts-expect-error
    // becomes a compile error and `make typecheck` will catch it. The
    // runtime expectation is just there so vitest counts the case.
    //
    // Future-proofing: when adding a new persisted field to GroupPatch,
    // add it to `patchHasChanges` AND `mergeGroupPatch` together — that's
    // the lockstep pair that P0-1 was missing.
    // @ts-expect-error: 'unknown_field' is not a key of GroupPatch
    const bad: GroupPatch = { unknown_field: 'x' };
    expect(typeof bad).toBe('object');
  });

  test('empty patch is the only no-op shape', () => {
    // Documenting the inverse: any single field set to its meaningful
    // sentinel value (string for name, the runtime values for runtime,
    // null for clear-override) is a write.
    expect(patchHasChanges({})).toBe(false);
    expect(patchHasChanges({ name: '' })).toBe(false); // empty name = no rename
    expect(patchHasChanges({ activation_mode: undefined })).toBe(false);
  });
});

describe('mergeGroupPatch — field write-through + preservation', () => {
  test('cursor_model: pin overrides existing null', () => {
    const out = mergeGroupPatch(
      baseGroup(),
      { cursor_model: 'composer-2-fast' },
    );
    expect(out.cursor_model).toBe('composer-2-fast');
  });

  test('cursor_model: pin overrides existing pinned value', () => {
    const out = mergeGroupPatch(
      baseGroup({ cursor_model: 'auto' }),
      { cursor_model: 'composer-2-fast' },
    );
    expect(out.cursor_model).toBe('composer-2-fast');
  });

  test('cursor_model: null clears existing pinned value (back to inherit)', () => {
    const out = mergeGroupPatch(
      baseGroup({ cursor_model: 'composer-2-fast' }),
      { cursor_model: null },
    );
    expect(out.cursor_model).toBeNull();
  });

  test('cursor_model: undefined preserves existing value', () => {
    const out = mergeGroupPatch(
      baseGroup({ cursor_model: 'auto' }),
      {},
    );
    expect(out.cursor_model).toBe('auto');
  });

  test('runtime: same three-state semantics as cursor_model', () => {
    expect(
      mergeGroupPatch(baseGroup(), { runtime: 'cursor' }).runtime,
    ).toBe('cursor');
    expect(
      mergeGroupPatch(baseGroup({ runtime: 'cursor' }), { runtime: null })
        .runtime,
    ).toBeNull();
    expect(
      mergeGroupPatch(baseGroup({ runtime: 'cursor' }), {}).runtime,
    ).toBe('cursor');
  });

  test('all unrelated fields are preserved when only cursor_model changes', () => {
    const existing = baseGroup({
      name: 'Custom',
      executionMode: 'host',
      activation_mode: 'when_mentioned',
      runtime: 'cursor',
      cursor_model: 'auto',
      created_by: 'user-id-123',
      target_agent_id: 'agent-x',
    });
    const out = mergeGroupPatch(existing, { cursor_model: 'gpt-5.5-high' });
    expect(out.name).toBe('Custom');
    expect(out.executionMode).toBe('host');
    expect(out.activation_mode).toBe('when_mentioned');
    expect(out.runtime).toBe('cursor');
    expect(out.created_by).toBe('user-id-123');
    expect(out.target_agent_id).toBe('agent-x');
    // Only the patched field changed.
    expect(out.cursor_model).toBe('gpt-5.5-high');
  });

  test('combined patch: name + cursor_model both apply', () => {
    const out = mergeGroupPatch(
      baseGroup(),
      { name: 'Renamed', cursor_model: 'composer-2-fast' },
    );
    expect(out.name).toBe('Renamed');
    expect(out.cursor_model).toBe('composer-2-fast');
  });

  test('merge is deterministic and pure', () => {
    const existing = baseGroup({ cursor_model: 'auto' });
    const patch: GroupPatch = { cursor_model: 'composer-2-fast' };
    const a = mergeGroupPatch(existing, patch);
    const b = mergeGroupPatch(existing, patch);
    expect(a).toEqual(b);
    // Existing must not be mutated.
    expect(existing.cursor_model).toBe('auto');
  });
});
