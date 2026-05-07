/**
 * Schema-level unit tests for the Step 6 runtime API surface.
 *
 * Pins the contract that PUT /api/auth/profile accepts `default_runtime`
 * and PATCH /api/groups/:jid accepts `runtime` (with `null` to clear the
 * per-group override). Invalid values must be rejected at the schema layer
 * so route handlers don't have to defend a second time.
 */
import { describe, expect, test } from 'vitest';

import {
  CursorModelSchema,
  GroupPatchSchema,
  ProfileUpdateSchema,
  RuntimeSchema,
} from '../../src/schemas.js';

describe('RuntimeSchema (shared enum)', () => {
  test('accepts the two canonical literals', () => {
    expect(RuntimeSchema.parse('claude')).toBe('claude');
    expect(RuntimeSchema.parse('cursor')).toBe('cursor');
  });

  test('rejects unknown strings and non-strings', () => {
    expect(() => RuntimeSchema.parse('Claude')).toThrow(); // case-sensitive
    expect(() => RuntimeSchema.parse('')).toThrow();
    expect(() => RuntimeSchema.parse(null)).toThrow();
    expect(() => RuntimeSchema.parse(undefined)).toThrow();
    expect(() => RuntimeSchema.parse(42)).toThrow();
    expect(() => RuntimeSchema.parse({ runtime: 'cursor' })).toThrow();
  });
});

describe('ProfileUpdateSchema — default_runtime', () => {
  test('accepts default_runtime: claude', () => {
    const out = ProfileUpdateSchema.parse({ default_runtime: 'claude' });
    expect(out.default_runtime).toBe('claude');
  });

  test('accepts default_runtime: cursor', () => {
    const out = ProfileUpdateSchema.parse({ default_runtime: 'cursor' });
    expect(out.default_runtime).toBe('cursor');
  });

  test('omitting default_runtime leaves it undefined (optional)', () => {
    const out = ProfileUpdateSchema.parse({});
    expect('default_runtime' in out ? out.default_runtime : undefined).toBeUndefined();
  });

  test('rejects null (use the field absence, not null, to keep current value)', () => {
    expect(() =>
      ProfileUpdateSchema.parse({ default_runtime: null }),
    ).toThrow();
  });

  test('rejects unknown literal', () => {
    expect(() =>
      ProfileUpdateSchema.parse({ default_runtime: 'codex' }),
    ).toThrow();
  });

  test('combines cleanly with other profile fields', () => {
    const out = ProfileUpdateSchema.parse({
      display_name: 'Alice',
      default_runtime: 'cursor',
    });
    expect(out.display_name).toBe('Alice');
    expect(out.default_runtime).toBe('cursor');
  });
});

describe('GroupPatchSchema — runtime', () => {
  test('accepts runtime: claude (pin override)', () => {
    const out = GroupPatchSchema.parse({ runtime: 'claude' });
    expect(out.runtime).toBe('claude');
  });

  test('accepts runtime: cursor (pin override)', () => {
    const out = GroupPatchSchema.parse({ runtime: 'cursor' });
    expect(out.runtime).toBe('cursor');
  });

  test('accepts runtime: null (clear per-group override)', () => {
    const out = GroupPatchSchema.parse({ runtime: null });
    expect(out.runtime).toBeNull();
  });

  test('rejects unknown literal even when nullable', () => {
    expect(() => GroupPatchSchema.parse({ runtime: 'codex' })).toThrow();
  });

  test('rejects empty string (must be claude/cursor/null)', () => {
    expect(() => GroupPatchSchema.parse({ runtime: '' })).toThrow();
  });

  test('combines cleanly with other group patch fields', () => {
    const out = GroupPatchSchema.parse({
      name: 'My workspace',
      activation_mode: 'always',
      runtime: 'cursor',
    });
    expect(out.name).toBe('My workspace');
    expect(out.activation_mode).toBe('always');
    expect(out.runtime).toBe('cursor');
  });

  test('runtime is optional — patch can omit it entirely', () => {
    const out = GroupPatchSchema.parse({ name: 'just-a-rename' });
    expect('runtime' in out ? out.runtime : undefined).toBeUndefined();
  });
});

describe('CursorModelSchema (shared model id validator)', () => {
  test('accepts realistic cursor model ids (dash + dot variants)', () => {
    expect(CursorModelSchema.parse('claude-opus-4-7-thinking-max')).toBe(
      'claude-opus-4-7-thinking-max',
    );
    expect(CursorModelSchema.parse('claude-4.6-sonnet-medium')).toBe(
      'claude-4.6-sonnet-medium',
    );
    expect(CursorModelSchema.parse('gpt-5.3-codex-spark-preview-xhigh')).toBe(
      'gpt-5.3-codex-spark-preview-xhigh',
    );
    expect(CursorModelSchema.parse('auto')).toBe('auto');
    expect(CursorModelSchema.parse('composer-2-fast')).toBe('composer-2-fast');
  });

  test('rejects empty / too long / invalid charset', () => {
    expect(() => CursorModelSchema.parse('')).toThrow();
    expect(() => CursorModelSchema.parse('a'.repeat(200))).toThrow();
    // No spaces.
    expect(() => CursorModelSchema.parse('claude opus')).toThrow();
    // No path traversal / shell metacharacters.
    expect(() => CursorModelSchema.parse('claude/../etc')).toThrow();
    expect(() => CursorModelSchema.parse('claude;rm -rf /')).toThrow();
  });
});

describe('ProfileUpdateSchema — cursor_model', () => {
  test('accepts a valid cursor_model id', () => {
    const out = ProfileUpdateSchema.parse({
      cursor_model: 'claude-opus-4-7-thinking-max',
    });
    expect(out.cursor_model).toBe('claude-opus-4-7-thinking-max');
  });

  test('accepts cursor_model: null (clear per-user override)', () => {
    const out = ProfileUpdateSchema.parse({ cursor_model: null });
    expect(out.cursor_model).toBeNull();
  });

  test('rejects empty string and bad charset', () => {
    expect(() => ProfileUpdateSchema.parse({ cursor_model: '' })).toThrow();
    expect(() => ProfileUpdateSchema.parse({ cursor_model: 'cursor model' })).toThrow();
  });

  test('combines with default_runtime', () => {
    const out = ProfileUpdateSchema.parse({
      default_runtime: 'cursor',
      cursor_model: 'composer-2-fast',
    });
    expect(out.default_runtime).toBe('cursor');
    expect(out.cursor_model).toBe('composer-2-fast');
  });
});

describe('GroupPatchSchema — cursor_model', () => {
  test('accepts a valid cursor_model id (pin)', () => {
    const out = GroupPatchSchema.parse({ cursor_model: 'gpt-5.5-high' });
    expect(out.cursor_model).toBe('gpt-5.5-high');
  });

  test('accepts cursor_model: null (clear per-group override)', () => {
    const out = GroupPatchSchema.parse({ cursor_model: null });
    expect(out.cursor_model).toBeNull();
  });

  test('rejects empty string and invalid charset', () => {
    expect(() => GroupPatchSchema.parse({ cursor_model: '' })).toThrow();
    expect(() => GroupPatchSchema.parse({ cursor_model: 'evil; rm' })).toThrow();
  });

  test('combines with runtime', () => {
    const out = GroupPatchSchema.parse({
      runtime: 'cursor',
      cursor_model: 'auto',
    });
    expect(out.runtime).toBe('cursor');
    expect(out.cursor_model).toBe('auto');
  });
});
