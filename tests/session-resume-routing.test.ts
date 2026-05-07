/**
 * Regression test for runtime-aware session resume routing (P0-2 in the
 * 2026-05-06 review).
 *
 * The bug: `runAgent` read `sessions[folder]` (an in-memory hot-path cache)
 * directly. When a user PATCH'd a group's runtime in the Web UI (e.g. cursor
 * → claude), `setRegisteredGroup` updated DB but did NOT evict the in-memory
 * cache, so the next message handed the wrong runner a stale resume id from
 * the wrong column.
 *
 * The fix: `runAgent` now calls `getResumeId(group)` (which is runtime-aware
 * and routes to the correct DB column on every call). This test pins the
 * behavior of the underlying DB getter pair so a future refactor can't
 * accidentally re-introduce the cross-column read.
 *
 * Pure DB-level test — bootstraps a tmp SQLite DB and exercises:
 *   - `setSession`           → writes `session_id` (claude SDK token)
 *   - `setSessionCursorChatId` → writes `cursor_chat_id`
 *   - `getSession`           → reads `session_id`  (independent of cursor side)
 *   - `getSessionCursorChatId` → reads `cursor_chat_id` (independent of claude side)
 *
 * The runtime decision lives in `getResumeId` inside `src/session-resume.ts`;
 * this test pins (a) that the two columns ARE independent so the higher-level
 * routing has something correct to dispatch to, and (b) that
 * `getResumeId` / `runtimeForGroup` route reads to the right column based on
 * the resolved runtime (the actual P0-2 regression).
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'session-resume-routing-test-'),
);
const tmpStoreDir = path.join(tmpDir, 'db');
const tmpGroupsDir = path.join(tmpDir, 'groups');
fs.mkdirSync(tmpStoreDir, { recursive: true });
fs.mkdirSync(tmpGroupsDir, { recursive: true });

vi.mock('../src/config.js', async () => {
  return {
    STORE_DIR: tmpStoreDir,
    GROUPS_DIR: tmpGroupsDir,
  };
});

const {
  initDatabase,
  setSession,
  getSession,
  setSessionCursorChatId,
  getSessionCursorChatId,
  deleteSession,
} = await import('../src/db.js');
const { getResumeId, runtimeForGroup } = await import(
  '../src/session-resume.js'
);
import type { RegisteredGroup } from '../src/types';

/** Minimal RegisteredGroup factory for test fixtures — only fills the fields
 * `runtimeForGroup`/`getResumeId` actually consult, so we avoid threading
 * the full 25-field type through every test. `created_by` is intentionally
 * left undefined: with no owner, `runtimeForGroup` falls through to the
 * group override (or DEFAULT_RUNTIME='claude' when both are absent), keeping
 * the test free of the user-creation billing side-effects. */
function fixtureGroup(
  folder: string,
  runtime?: 'claude' | 'cursor' | null,
): RegisteredGroup {
  return {
    name: `Test ${folder}`,
    folder,
    added_at: '2026-05-01T00:00:00.000Z',
    runtime,
  };
}

beforeAll(() => {
  initDatabase();
});

afterAll(() => {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe('sessions.session_id vs sessions.cursor_chat_id — independent columns', () => {
  test('writing claude session_id does not touch cursor_chat_id', () => {
    setSession('folder-A', 'claude-session-AAA');
    expect(getSession('folder-A')).toBe('claude-session-AAA');
    expect(getSessionCursorChatId('folder-A')).toBeUndefined();
  });

  test('writing cursor_chat_id later does not touch session_id', () => {
    setSessionCursorChatId('folder-A', '', 'cursor-chat-XYZ');
    expect(getSession('folder-A')).toBe('claude-session-AAA');
    expect(getSessionCursorChatId('folder-A')).toBe('cursor-chat-XYZ');
  });

  test('runtime PATCH simulation: switching cursor → claude reads claude id, not stale cursor id', () => {
    // Simulate the "user used cursor for a while, then switched to claude" flow:
    setSessionCursorChatId('folder-B', '', 'cursor-chat-stale');
    // Then claude turn writes its own session id:
    setSession('folder-B', 'claude-fresh-token');

    // The bug-version cache (`sessions[folder] = output.newSessionId`) might
    // still hold 'cursor-chat-stale' until something rebuilt it. The fixed
    // path always asks DB for the current claude column, which is fresh:
    expect(getSession('folder-B')).toBe('claude-fresh-token');
    // Cursor column kept its old chat id intact so a switch-back can resume.
    expect(getSessionCursorChatId('folder-B')).toBe('cursor-chat-stale');
  });

  test('claude turn writing session_id does NOT clobber existing cursor_chat_id', () => {
    setSessionCursorChatId('folder-C', '', 'cursor-keep-me');
    setSession('folder-C', 'claude-new');
    expect(getSession('folder-C')).toBe('claude-new');
    expect(getSessionCursorChatId('folder-C')).toBe('cursor-keep-me');
  });

  test('cursor turn writing cursor_chat_id does NOT clobber existing session_id', () => {
    setSession('folder-D', 'claude-keep-me');
    setSessionCursorChatId('folder-D', '', 'cursor-new');
    expect(getSession('folder-D')).toBe('claude-keep-me');
    expect(getSessionCursorChatId('folder-D')).toBe('cursor-new');
  });

  test('null clears cursor_chat_id without touching session_id', () => {
    setSession('folder-E', 'claude-stays');
    setSessionCursorChatId('folder-E', '', 'cursor-removable');
    expect(getSessionCursorChatId('folder-E')).toBe('cursor-removable');

    setSessionCursorChatId('folder-E', '', null);
    expect(getSessionCursorChatId('folder-E')).toBeUndefined();
    // Claude column untouched.
    expect(getSession('folder-E')).toBe('claude-stays');
  });

  test('sub-agent isolation: per-agent_id cursor_chat_id and claude session_id', () => {
    setSession('folder-F', 'main-claude', '');
    setSession('folder-F', 'sub-claude', 'agent-1');
    setSessionCursorChatId('folder-F', '', 'main-cursor');
    setSessionCursorChatId('folder-F', 'agent-1', 'sub-cursor');

    expect(getSession('folder-F')).toBe('main-claude');
    expect(getSession('folder-F', 'agent-1')).toBe('sub-claude');
    expect(getSessionCursorChatId('folder-F')).toBe('main-cursor');
    expect(getSessionCursorChatId('folder-F', 'agent-1')).toBe('sub-cursor');
  });

  test('deleteSession removes both columns for the targeted (folder, agent_id)', () => {
    setSession('folder-G', 'claude-G');
    setSessionCursorChatId('folder-G', '', 'cursor-G');
    deleteSession('folder-G');
    expect(getSession('folder-G')).toBeUndefined();
    expect(getSessionCursorChatId('folder-G')).toBeUndefined();
  });
});

describe('runtimeForGroup — group-level override', () => {
  // These cases pin the group → DEFAULT_RUNTIME ends of the chain. The
  // middle leg (no group override + owner.default_runtime) is covered by
  // the pure-function `tests/units/runtime-resolver.test.ts` — there's no
  // value re-running it here against the same `resolveGroupRuntime` pure
  // function, and the fixture intentionally avoids `created_by` to skip
  // `createUser`'s billing side-effects.
  test('group.runtime="cursor" override is honored when no owner exists', () => {
    expect(runtimeForGroup(fixtureGroup('rt-cursor', 'cursor'))).toBe('cursor');
  });

  test('group.runtime="claude" override is honored when no owner exists', () => {
    expect(runtimeForGroup(fixtureGroup('rt-claude', 'claude'))).toBe('claude');
  });

  test('no group override + no owner → DEFAULT_RUNTIME (claude)', () => {
    expect(runtimeForGroup(fixtureGroup('rt-default'))).toBe('claude');
    expect(runtimeForGroup(fixtureGroup('rt-default-null', null))).toBe('claude');
  });
});

describe('getResumeId — runtime-aware DB column dispatch (P0-2 regression)', () => {
  test('cursor group reads cursor_chat_id column', () => {
    const group = fixtureGroup('rt-cursor-A', 'cursor');
    setSession(group.folder, 'claude-token-IGNORED');
    setSessionCursorChatId(group.folder, '', 'cursor-correct');
    expect(getResumeId(group)).toBe('cursor-correct');
    expect(getResumeId(group, '')).toBe('cursor-correct');
  });

  test('claude group reads session_id column (and ignores cursor_chat_id)', () => {
    const group = fixtureGroup('rt-claude-A', 'claude');
    setSession(group.folder, 'claude-correct');
    setSessionCursorChatId(group.folder, '', 'cursor-token-IGNORED');
    expect(getResumeId(group)).toBe('claude-correct');
  });

  test('cursor group with NO cursor_chat_id stored: getResumeId does NOT return stale claude id', () => {
    // The exact scenario P0-2 patched: a group whose runtime was just flipped
    // from claude → cursor. The DB still has session_id from the claude era
    // but cursor_chat_id is empty. getResumeId must NOT fall back to the
    // claude column; cursor-runner should start a fresh chat.
    const group = fixtureGroup('rt-flipped', 'cursor');
    setSession(group.folder, 'leftover-claude-token');
    expect(getResumeId(group)).not.toBe('leftover-claude-token');
    // setSession leaves cursor_chat_id NULL → undefined, falsy.
    expect(getResumeId(group)).toBeFalsy();
  });

  test('claude group with NO session_id stored: getResumeId does NOT return stale cursor id', () => {
    // Symmetric: a group flipped cursor → claude. cursor_chat_id is leftover
    // but session_id is the helper's default empty string. getResumeId must
    // NOT hand the cursor chat id to the claude SDK; an empty session_id is
    // an acceptable "no resume" sentinel for the claude path.
    const group = fixtureGroup('rt-flipped-2', 'claude');
    setSessionCursorChatId(group.folder, '', 'leftover-cursor-chat');
    expect(getResumeId(group)).not.toBe('leftover-cursor-chat');
    // setSessionCursorChatId initializes session_id=''  (asymmetric with
    // setSession which leaves cursor_chat_id NULL); both shapes are falsy
    // and downstream callers treat them as "start a fresh session".
    expect(getResumeId(group)).toBeFalsy();
  });

  test('runtime PATCH simulation: id read flips with the runtime, no manual cache evict needed', () => {
    // The headline P0-2 case: user toggles backend mid-session. Without the
    // fix, runAgent saw a stale `sessions[folder]` cache; with the fix,
    // getResumeId always returns the column matching the CURRENT runtime.
    const folder = 'rt-toggle';
    setSession(folder, 'claude-id');
    setSessionCursorChatId(folder, '', 'cursor-id');

    const cursorGroup = fixtureGroup(folder, 'cursor');
    const claudeGroup = fixtureGroup(folder, 'claude');

    // Same folder, different group.runtime → different id, no DB rewrite.
    expect(getResumeId(cursorGroup)).toBe('cursor-id');
    expect(getResumeId(claudeGroup)).toBe('claude-id');
    // Switching back yields the correct column again — both sides retained.
    expect(getResumeId(cursorGroup)).toBe('cursor-id');
  });

  test('sub-agent: getResumeId routes by agentId + runtime in tandem', () => {
    const folder = 'rt-sub';
    setSession(folder, 'main-claude', '');
    setSession(folder, 'sub-claude', 'agent-X');
    setSessionCursorChatId(folder, '', 'main-cursor');
    setSessionCursorChatId(folder, 'agent-X', 'sub-cursor');

    const cursorGroup = fixtureGroup(folder, 'cursor');
    const claudeGroup = fixtureGroup(folder, 'claude');

    expect(getResumeId(cursorGroup)).toBe('main-cursor');
    expect(getResumeId(cursorGroup, 'agent-X')).toBe('sub-cursor');
    expect(getResumeId(claudeGroup)).toBe('main-claude');
    expect(getResumeId(claudeGroup, 'agent-X')).toBe('sub-claude');
  });
});
