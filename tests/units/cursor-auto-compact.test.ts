/**
 * Unit tests for cursor-runner's token-based auto-compact (the Cursor-side
 * analog of Claude SDK's PreCompact hook).
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  buildArchiveMarkdown,
  createState,
  defaultArchiveName,
  pushTurn,
  resetState,
  shouldCompact,
  writeArchive,
} from '../../container/cursor-runner/src/auto-compact.js';

let workspaceDir: string;

beforeEach(() => {
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-compact-'));
});

afterEach(() => {
  try {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('cumulative token tracking', () => {
  test('createState returns zeroed state', () => {
    const s = createState();
    expect(s.log).toEqual([]);
    expect(s.cumulativeTokens).toBe(0);
  });

  test('pushTurn accumulates input + output tokens', () => {
    const s = createState();
    pushTurn(s, {
      timestamp: 't1',
      user: 'u1',
      assistant: 'a1',
      inputTokens: 10,
      outputTokens: 20,
    });
    expect(s.cumulativeTokens).toBe(30);
    pushTurn(s, {
      timestamp: 't2',
      user: 'u2',
      assistant: 'a2',
      inputTokens: 5,
      outputTokens: 100,
    });
    expect(s.cumulativeTokens).toBe(135);
    expect(s.log.length).toBe(2);
  });

  test('resetState clears log + tokens, returns previous values', () => {
    const s = createState();
    pushTurn(s, {
      timestamp: 't',
      user: 'u',
      assistant: 'a',
      inputTokens: 50,
      outputTokens: 50,
    });
    const prev = resetState(s);
    expect(prev.cumulativeTokens).toBe(100);
    expect(prev.log.length).toBe(1);
    expect(s.cumulativeTokens).toBe(0);
    expect(s.log).toEqual([]);
  });
});

describe('shouldCompact threshold', () => {
  const mkState = (tokens: number) => {
    const s = createState();
    if (tokens > 0) {
      pushTurn(s, {
        timestamp: 't',
        user: 'u',
        assistant: 'a',
        inputTokens: tokens,
        outputTokens: 0,
      });
    }
    return s;
  };

  test('threshold 0 disables compaction', () => {
    expect(shouldCompact(mkState(1_000_000), 0)).toBe(false);
    expect(shouldCompact(mkState(0), 0)).toBe(false);
  });

  test('negative threshold disables compaction', () => {
    expect(shouldCompact(mkState(1_000_000), -1)).toBe(false);
  });

  test('below threshold → false', () => {
    expect(shouldCompact(mkState(199_999), 200_000)).toBe(false);
  });

  test('at threshold → true', () => {
    expect(shouldCompact(mkState(200_000), 200_000)).toBe(true);
  });

  test('above threshold → true', () => {
    expect(shouldCompact(mkState(800_001), 800_000)).toBe(true);
  });
});

describe('buildArchiveMarkdown', () => {
  test('header carries group / chatId / threshold / token totals', () => {
    const md = buildArchiveMarkdown(
      [
        { timestamp: '2026-05-06T18:00:00Z', user: 'u1', assistant: 'a1', inputTokens: 100, outputTokens: 200 },
        { timestamp: '2026-05-06T18:01:00Z', user: 'u2', assistant: 'a2', inputTokens: 300, outputTokens: 400 },
      ],
      {
        groupFolder: 'home-42',
        chatId: 'chat-abc',
        archivedAt: '2026-05-06T18:01:30Z',
        threshold: 800_000,
      },
    );
    expect(md).toContain('# Cursor Auto-Compact Archive');
    expect(md).toContain('Group: home-42');
    expect(md).toContain('Cursor chat ID: chat-abc');
    expect(md).toContain('Threshold: 800000 tokens');
    expect(md).toContain('Turns: 2');
    expect(md).toContain('input=400, output=600, total=1000');
  });

  test('absent chatId rendered as "(none — first turn)"', () => {
    const md = buildArchiveMarkdown(
      [
        { timestamp: 't', user: 'u', assistant: 'a', inputTokens: 0, outputTokens: 0 },
      ],
      { groupFolder: 'g', chatId: undefined, archivedAt: 't', threshold: 1 },
    );
    expect(md).toContain('Cursor chat ID: (none — first turn)');
  });

  test('per-turn body has user + assistant + token annotation', () => {
    const md = buildArchiveMarkdown(
      [
        { timestamp: '2026-05-06T18:00:00Z', user: 'hello', assistant: 'world', inputTokens: 10, outputTokens: 20 },
      ],
      { groupFolder: 'g', chatId: 'c', archivedAt: 't', threshold: 1 },
    );
    expect(md).toContain('## Turn 1 — 2026-05-06T18:00:00Z');
    expect(md).toContain('input=10, output=20');
    expect(md).toContain('**User**:');
    expect(md).toContain('hello');
    expect(md).toContain('**Assistant**:');
    expect(md).toContain('world');
  });

  test('overlong user/assistant text is truncated with marker', () => {
    const huge = 'x'.repeat(5000);
    const md = buildArchiveMarkdown(
      [
        { timestamp: 't', user: huge, assistant: huge, inputTokens: 0, outputTokens: 0 },
      ],
      { groupFolder: 'g', chatId: 'c', archivedAt: 't', threshold: 1 },
    );
    expect(md).toContain('…(truncated)');
    expect(md.length).toBeLessThan(huge.length * 2 + 1000);
  });
});

describe('writeArchive — atomic file IO', () => {
  test('writes to <workspace>/conversations/<filename>.md', () => {
    const out = writeArchive(workspaceDir, '2026-05-06-cursor-abc', '# hi\n');
    expect(out).toBe(path.join(workspaceDir, 'conversations', '2026-05-06-cursor-abc.md'));
    expect(fs.readFileSync(out, 'utf-8')).toBe('# hi\n');
  });

  test('empty content → no file created, returns ""', () => {
    const out = writeArchive(workspaceDir, 'test', '');
    expect(out).toBe('');
    expect(fs.existsSync(path.join(workspaceDir, 'conversations'))).toBe(false);
  });

  test('sanitizes path-traversal characters in filename', () => {
    const out = writeArchive(workspaceDir, '../../../evil/path', '# x\n');
    // The dangerous parts should be replaced with dashes.
    expect(out.startsWith(path.join(workspaceDir, 'conversations'))).toBe(true);
    expect(out).not.toContain('..');
    expect(out).not.toContain('evil/path');
  });

  test('long filenameBase capped at 80 chars', () => {
    const long = 'a'.repeat(200);
    const out = writeArchive(workspaceDir, long, '# x\n');
    const basename = path.basename(out, '.md');
    expect(basename.length).toBeLessThanOrEqual(80);
  });

  test('no leftover .tmp file after successful write', () => {
    writeArchive(workspaceDir, 'test', '# x\n');
    const dir = path.join(workspaceDir, 'conversations');
    const entries = fs.readdirSync(dir);
    expect(entries).toEqual(['test.md']);
  });
});

describe('defaultArchiveName', () => {
  test('combines timestamp + chatId prefix (chatId capped at 12 chars)', () => {
    const name = defaultArchiveName('chat-abcdef123456789', '2026-05-06T18:01:30.123Z');
    expect(name).toContain('2026-05-06T18-01-30-123Z');
    // chatId.slice(0, 12) of 'chat-abcdef123456789' = 'chat-abcdef1'
    expect(name).toContain('cursor-chat-abcdef1');
  });

  test('handles missing chatId', () => {
    const name = defaultArchiveName(undefined, '2026-05-06T18:01:30Z');
    expect(name).toContain('cursor-first');
  });
});
