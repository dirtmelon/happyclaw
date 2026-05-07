/**
 * Tests for the happyclaw-mcp-server context file protocol.
 *
 * The mutable subset of McpContext (chatJid / currentTaskId / isScheduledTask)
 * is shared between the agent-runner main process and the standalone stdio
 * MCP server via `<workspaceIpc>/current-context.json`. agent-runner does
 * atomic writes (tmp + rename); the MCP server reads on every tool call.
 *
 * These tests pin three invariants:
 *   1. fresh-startup case: missing file → fall back to static defaults
 *   2. corrupt-JSON case: must NOT throw, fall back to static defaults
 *   3. atomic-write case: tmp+rename produces a consistent visible value
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  buildMcpContext,
  loadMutableContext,
  parseStaticContext,
  type StaticContext,
} from '../../container/happyclaw-mcp-server/src/context.js';

const STATIC_BASE: StaticContext = {
  groupFolder: 'probe',
  isHome: true,
  isAdminHome: false,
  workspaceIpc: '',
  workspaceGroup: '/tmp/probe-group',
  workspaceGlobal: '/tmp/probe-global',
  workspaceMemory: '/tmp/probe-memory',
  disableMemoryLayer: false,
  initialChatJid: 'web:probe-startup',
  initialIsScheduledTask: false,
};

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ctx-'));
});

afterEach(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('loadMutableContext — file IO safety', () => {
  test('missing file → empty mutable context (fallback to static)', () => {
    const result = loadMutableContext(tmpDir);
    expect(result).toEqual({});
  });

  test('corrupt JSON → empty mutable context, no throw', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      '{not valid json',
    );
    expect(() => loadMutableContext(tmpDir)).not.toThrow();
    expect(loadMutableContext(tmpDir)).toEqual({});
  });

  test('non-object JSON (e.g. array, string) → empty', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      '"just a string"',
    );
    expect(loadMutableContext(tmpDir)).toEqual({});

    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify(['array', 'of', 'things']),
    );
    expect(loadMutableContext(tmpDir)).toEqual({});

    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      'null',
    );
    expect(loadMutableContext(tmpDir)).toEqual({});
  });

  test('valid JSON with all fields → returns all fields', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify({
        chatJid: 'feishu:dynamic-jid',
        currentTaskId: 'task-99',
        isScheduledTask: true,
      }),
    );
    expect(loadMutableContext(tmpDir)).toEqual({
      chatJid: 'feishu:dynamic-jid',
      currentTaskId: 'task-99',
      isScheduledTask: true,
    });
  });

  test('valid JSON with currentTaskId=null is preserved (vs missing key)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify({ chatJid: 'web:x', currentTaskId: null }),
    );
    const result = loadMutableContext(tmpDir);
    expect(result.currentTaskId).toBeNull();
    expect('currentTaskId' in result).toBe(true);
  });

  test('extra unknown keys are ignored, no throw', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify({ chatJid: 'web:x', mystery: 42, foo: { nested: true } }),
    );
    const result = loadMutableContext(tmpDir);
    expect(result.chatJid).toBe('web:x');
    expect((result as Record<string, unknown>).mystery).toBeUndefined();
  });

  test('wrong types are silently dropped (e.g. chatJid=number)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify({ chatJid: 12345, isScheduledTask: 'yes' }),
    );
    const result = loadMutableContext(tmpDir);
    expect(result.chatJid).toBeUndefined();
    expect(result.isScheduledTask).toBeUndefined();
  });
});

describe('buildMcpContext — static + mutable merge', () => {
  test('no file → static initial values surface', () => {
    const ctx = buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir });
    expect(ctx.chatJid).toBe('web:probe-startup');
    expect(ctx.currentTaskId).toBeNull();
    expect(ctx.isScheduledTask).toBe(false);
    expect(ctx.groupFolder).toBe('probe');
  });

  test('mutable file overrides chatJid + currentTaskId', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify({
        chatJid: 'feishu:turn-2',
        currentTaskId: 'task-7',
      }),
    );
    const ctx = buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir });
    expect(ctx.chatJid).toBe('feishu:turn-2');
    expect(ctx.currentTaskId).toBe('task-7');
    expect(ctx.isScheduledTask).toBe(false); // unchanged from static default
  });

  test('mutable file partial → only specified fields override', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify({ currentTaskId: 'task-3' }),
    );
    const ctx = buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir });
    expect(ctx.chatJid).toBe('web:probe-startup'); // fell back to initial
    expect(ctx.currentTaskId).toBe('task-3');
  });

  test('static fields (workspaces / flags) are never affected by mutable file', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      JSON.stringify({
        // Try to spoof static-only fields — should be ignored.
        groupFolder: 'evil',
        workspaceGroup: '/etc/passwd',
        isHome: false,
      } as unknown as Record<string, unknown>),
    );
    const ctx = buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir });
    expect(ctx.groupFolder).toBe('probe');
    expect(ctx.workspaceGroup).toBe('/tmp/probe-group');
    expect(ctx.isHome).toBe(true);
  });

  test('repeated reads pick up latest atomic write (tmp + rename)', () => {
    const file = path.join(tmpDir, 'current-context.json');
    const tmp = file + '.tmp';

    fs.writeFileSync(tmp, JSON.stringify({ chatJid: 'web:first' }));
    fs.renameSync(tmp, file);
    expect(buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir }).chatJid)
      .toBe('web:first');

    fs.writeFileSync(tmp, JSON.stringify({ chatJid: 'web:second', currentTaskId: 'task-2' }));
    fs.renameSync(tmp, file);
    const ctx2 = buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir });
    expect(ctx2.chatJid).toBe('web:second');
    expect(ctx2.currentTaskId).toBe('task-2');
  });

  test('binary garbage in file does not crash buildMcpContext', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'current-context.json'),
      Buffer.from([0x00, 0xFF, 0x80, 0x7F, 0x00, 0x00]),
    );
    expect(() =>
      buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir }),
    ).not.toThrow();
    const ctx = buildMcpContext({ ...STATIC_BASE, workspaceIpc: tmpDir });
    expect(ctx.chatJid).toBe('web:probe-startup');
  });
});

describe('parseStaticContext — CLI flag parsing', () => {
  // argv shape mirrors process.argv: [node, script, ...flags]
  const fakeArgv = (...flags: string[]) => ['node', 'script', ...flags];

  test('all required flags present → static context populated', () => {
    const ctx = parseStaticContext(
      fakeArgv(
        '--group-folder', 'g1',
        '--workspace-group', '/w/g',
        '--workspace-ipc', '/w/i',
        '--workspace-global', '/w/gl',
        '--workspace-memory', '/w/m',
        '--is-home', 'true',
        '--is-admin-home', 'false',
        '--chat-jid', 'web:initial',
      ),
    );
    expect(ctx.groupFolder).toBe('g1');
    expect(ctx.workspaceGroup).toBe('/w/g');
    expect(ctx.workspaceIpc).toBe('/w/i');
    expect(ctx.isHome).toBe(true);
    expect(ctx.isAdminHome).toBe(false);
    expect(ctx.initialChatJid).toBe('web:initial');
    expect(ctx.disableMemoryLayer).toBe(false);
    expect(ctx.initialIsScheduledTask).toBe(false);
  });

  test('boolean-only flags (no value) work', () => {
    const ctx = parseStaticContext(
      fakeArgv(
        '--group-folder', 'g',
        '--workspace-group', '/g',
        '--workspace-ipc', '/i',
        '--workspace-global', '/gl',
        '--workspace-memory', '/m',
        '--is-home',
        '--disable-memory-layer',
        '--is-scheduled-task',
      ),
    );
    expect(ctx.isHome).toBe(true);
    expect(ctx.disableMemoryLayer).toBe(true);
    expect(ctx.initialIsScheduledTask).toBe(true);
    expect(ctx.isAdminHome).toBe(false); // not set
  });

  test('--key=value form parses', () => {
    const ctx = parseStaticContext(
      fakeArgv(
        '--group-folder=foo',
        '--workspace-group=/wg',
        '--workspace-ipc=/wi',
        '--workspace-global=/wgl',
        '--workspace-memory=/wm',
      ),
    );
    expect(ctx.groupFolder).toBe('foo');
    expect(ctx.workspaceGroup).toBe('/wg');
  });

  test('missing required flag throws', () => {
    expect(() =>
      parseStaticContext(
        fakeArgv(
          '--group-folder', 'g',
          // workspace-group missing
          '--workspace-ipc', '/i',
          '--workspace-global', '/gl',
          '--workspace-memory', '/m',
        ),
      ),
    ).toThrow(/workspace-group/);
  });

  test('unknown flags are ignored', () => {
    const ctx = parseStaticContext(
      fakeArgv(
        '--group-folder', 'g',
        '--workspace-group', '/g',
        '--workspace-ipc', '/i',
        '--workspace-global', '/gl',
        '--workspace-memory', '/m',
        '--mystery-flag', 'whatever',
      ),
    );
    expect(ctx.groupFolder).toBe('g');
  });
});
