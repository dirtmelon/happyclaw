/**
 * Unit tests for the runtime resolution helper used by container-runner.ts
 * to pick agent-runner vs cursor-runner for a registered group.
 *
 * Resolution order: group.runtime → owner.default_runtime → DEFAULT_RUNTIME.
 */
import { describe, expect, test } from 'vitest';

import {
  resolveGroupRuntime,
  parseRuntimeStrict,
} from '../../src/runtime-resolver.js';

describe('resolveGroupRuntime — decision order', () => {
  test('group override wins over owner default', () => {
    expect(
      resolveGroupRuntime({ runtime: 'cursor' }, { default_runtime: 'claude' }),
    ).toBe('cursor');
    expect(
      resolveGroupRuntime({ runtime: 'claude' }, { default_runtime: 'cursor' }),
    ).toBe('claude');
  });

  test('no group runtime → owner default applies', () => {
    expect(
      resolveGroupRuntime({ runtime: undefined }, { default_runtime: 'cursor' }),
    ).toBe('cursor');
    expect(
      resolveGroupRuntime({ runtime: null }, { default_runtime: 'claude' }),
    ).toBe('claude');
  });

  test('null/undefined group also falls through', () => {
    expect(resolveGroupRuntime(undefined, { default_runtime: 'cursor' })).toBe(
      'cursor',
    );
    expect(resolveGroupRuntime(null, { default_runtime: 'claude' })).toBe(
      'claude',
    );
  });

  test('owner missing → DEFAULT_RUNTIME', () => {
    expect(resolveGroupRuntime({ runtime: undefined }, undefined)).toBe(
      'claude',
    );
    expect(resolveGroupRuntime(undefined, null)).toBe('claude');
  });

  test('invalid group runtime falls through to owner', () => {
    expect(
      resolveGroupRuntime(
        { runtime: 'foo' as unknown as 'claude' },
        { default_runtime: 'cursor' },
      ),
    ).toBe('cursor');
  });

  test('invalid both → DEFAULT_RUNTIME', () => {
    expect(
      resolveGroupRuntime(
        { runtime: 'foo' as unknown as 'claude' },
        { default_runtime: 'bar' as unknown as 'claude' },
      ),
    ).toBe('claude');
  });
});

describe('parseRuntimeStrict', () => {
  test('valid literals pass through', () => {
    expect(parseRuntimeStrict('claude')).toBe('claude');
    expect(parseRuntimeStrict('cursor')).toBe('cursor');
  });

  test('non-literals return null', () => {
    expect(parseRuntimeStrict('Claude')).toBeNull(); // case-sensitive
    expect(parseRuntimeStrict('')).toBeNull();
    expect(parseRuntimeStrict(null)).toBeNull();
    expect(parseRuntimeStrict(undefined)).toBeNull();
    expect(parseRuntimeStrict(42)).toBeNull();
    expect(parseRuntimeStrict({ runtime: 'cursor' })).toBeNull();
  });
});
