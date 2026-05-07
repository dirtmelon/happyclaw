/**
 * Unit tests for `resolveCursorModel` and `parseCursorModelsOutput`.
 *
 * Pins:
 *   - decision order group → user → env → hard default
 *   - empty / null / whitespace inputs treated as "unset"
 *   - parser handles real cursor-agent --list-models output (97 entries
 *     captured 2026-05-06)
 */
import { describe, expect, test } from 'vitest';

import {
  HARDCODED_DEFAULT_CURSOR_MODEL,
  envCursorModel,
  resolveCursorModel,
} from '../../src/cursor-model-resolver';
import { parseCursorModelsOutput } from '../../src/cursor-models-list';

describe('resolveCursorModel — decision chain', () => {
  test('group override beats user default beats env beats hard default', () => {
    expect(
      resolveCursorModel(
        { cursor_model: 'group-m' },
        { cursor_model: 'user-m' },
        'env-m',
      ),
    ).toBe('group-m');

    expect(
      resolveCursorModel(
        { cursor_model: null },
        { cursor_model: 'user-m' },
        'env-m',
      ),
    ).toBe('user-m');

    expect(
      resolveCursorModel({ cursor_model: null }, { cursor_model: null }, 'env-m'),
    ).toBe('env-m');

    expect(
      resolveCursorModel(
        { cursor_model: null },
        { cursor_model: null },
        undefined,
      ),
    ).toBe(HARDCODED_DEFAULT_CURSOR_MODEL);
  });

  test('hard default is "claude-opus-4-7-thinking-max" (operator requirement)', () => {
    expect(HARDCODED_DEFAULT_CURSOR_MODEL).toBe('claude-opus-4-7-thinking-max');
  });

  test('null group / null owner falls through to env then default', () => {
    expect(resolveCursorModel(null, null, 'env-m')).toBe('env-m');
    expect(resolveCursorModel(null, null, undefined)).toBe(
      HARDCODED_DEFAULT_CURSOR_MODEL,
    );
  });

  test('undefined group / undefined owner behaves like null', () => {
    expect(resolveCursorModel(undefined, undefined, 'env-m')).toBe('env-m');
  });

  test('empty string and whitespace-only override are treated as unset', () => {
    expect(
      resolveCursorModel(
        { cursor_model: '' },
        { cursor_model: 'user-m' },
        undefined,
      ),
    ).toBe('user-m');
    expect(
      resolveCursorModel(
        { cursor_model: '   ' },
        { cursor_model: 'user-m' },
        undefined,
      ),
    ).toBe('user-m');
  });

  test('whitespace is trimmed when the value is non-empty', () => {
    expect(
      resolveCursorModel(
        { cursor_model: '  group-m  ' },
        null,
        undefined,
      ),
    ).toBe('group-m');
  });
});

describe('envCursorModel', () => {
  test('reads CURSOR_MODEL from supplied env, trims whitespace', () => {
    expect(envCursorModel({ CURSOR_MODEL: 'foo' } as NodeJS.ProcessEnv)).toBe(
      'foo',
    );
    expect(envCursorModel({ CURSOR_MODEL: '  bar  ' } as NodeJS.ProcessEnv)).toBe(
      'bar',
    );
  });

  test('returns undefined for missing/empty/whitespace', () => {
    expect(envCursorModel({} as NodeJS.ProcessEnv)).toBeUndefined();
    expect(envCursorModel({ CURSOR_MODEL: '' } as NodeJS.ProcessEnv)).toBeUndefined();
    expect(
      envCursorModel({ CURSOR_MODEL: '\t  \n' } as NodeJS.ProcessEnv),
    ).toBeUndefined();
  });
});

// Real captured fragment of `cursor-agent --list-models --trust < /dev/null`
// from 2026-05-06. Mixes default / current markers, dot- and dash-versioned IDs
// and includes the "Tip:" footer + leading "Available models" banner.
const REAL_LIST_MODELS_OUTPUT = `\
Available models

auto - Auto
composer-2-fast - Composer 2 Fast (default)
composer-2 - Composer 2
gpt-5.3-codex-low - Codex 5.3 Low
gpt-5.3-codex-fast - Codex 5.3 Fast
claude-opus-4-7-thinking-high - Opus 4.7 1M High Thinking
claude-4.6-sonnet-medium - Sonnet 4.6 1M (current)
claude-4.6-sonnet-medium-thinking - Sonnet 4.6 1M Thinking
claude-opus-4-7-thinking-max - Opus 4.7 1M Max Thinking
gemini-3.1-pro - Gemini 3.1 Pro

Tip: use --model <id> (or /model <id> in interactive mode) to switch.
`;

describe('parseCursorModelsOutput', () => {
  test('parses representative fragment with 10 models', () => {
    const models = parseCursorModelsOutput(REAL_LIST_MODELS_OUTPUT);
    expect(models).toHaveLength(10);
    expect(models[0]).toEqual({
      id: 'auto',
      label: 'Auto',
      isDefault: false,
      isCurrent: false,
    });
  });

  test('extracts (default) marker and strips it from label', () => {
    const models = parseCursorModelsOutput(REAL_LIST_MODELS_OUTPUT);
    const composer = models.find((m) => m.id === 'composer-2-fast');
    expect(composer).toBeDefined();
    expect(composer?.isDefault).toBe(true);
    expect(composer?.isCurrent).toBe(false);
    expect(composer?.label).toBe('Composer 2 Fast');
  });

  test('extracts (current) marker and strips it from label', () => {
    const models = parseCursorModelsOutput(REAL_LIST_MODELS_OUTPUT);
    const sonnet = models.find((m) => m.id === 'claude-4.6-sonnet-medium');
    expect(sonnet).toBeDefined();
    expect(sonnet?.isDefault).toBe(false);
    expect(sonnet?.isCurrent).toBe(true);
    expect(sonnet?.label).toBe('Sonnet 4.6 1M');
  });

  test('handles ID with dashes (claude-opus-4-7-*) and dots (claude-4.6-*)', () => {
    const models = parseCursorModelsOutput(REAL_LIST_MODELS_OUTPUT);
    expect(models.find((m) => m.id === 'claude-opus-4-7-thinking-max')).toBeDefined();
    expect(models.find((m) => m.id === 'claude-4.6-sonnet-medium-thinking')).toBeDefined();
  });

  test('trailing Tip line is excluded', () => {
    const models = parseCursorModelsOutput(REAL_LIST_MODELS_OUTPUT);
    expect(models.some((m) => m.label.includes('Tip'))).toBe(false);
  });

  test('Available models banner is excluded', () => {
    const models = parseCursorModelsOutput(REAL_LIST_MODELS_OUTPUT);
    expect(models.some((m) => m.id === 'available')).toBe(false);
  });

  test('empty input returns empty array', () => {
    expect(parseCursorModelsOutput('')).toEqual([]);
  });

  test('garbage input (no recognizable lines) returns empty array', () => {
    expect(parseCursorModelsOutput('hello world\nfoo bar\nnot a model line')).toEqual([]);
  });

  test('handles CRLF line endings', () => {
    const crlf = REAL_LIST_MODELS_OUTPUT.replace(/\n/g, '\r\n');
    const models = parseCursorModelsOutput(crlf);
    expect(models).toHaveLength(10);
  });

  test('preserves model order from input', () => {
    const models = parseCursorModelsOutput(REAL_LIST_MODELS_OUTPUT);
    expect(models.map((m) => m.id)).toEqual([
      'auto',
      'composer-2-fast',
      'composer-2',
      'gpt-5.3-codex-low',
      'gpt-5.3-codex-fast',
      'claude-opus-4-7-thinking-high',
      'claude-4.6-sonnet-medium',
      'claude-4.6-sonnet-medium-thinking',
      'claude-opus-4-7-thinking-max',
      'gemini-3.1-pro',
    ]);
  });
});
