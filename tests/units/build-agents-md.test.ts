/**
 * Unit tests for cursor-runner's AGENTS.md generator.
 *
 * Pins:
 *   - section selection vs context flags (isHome, disableMemoryLayer,
 *     hasConversationAgentOverride, channel from chatJid)
 *   - safe degradation when promptsDir is missing or partial
 *   - atomic write semantics
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import {
  buildAgentsMd,
  writeAgentsMd,
} from '../../container/cursor-runner/src/build-agents-md.js';

// All prompt filenames the generator may pull from (must match the names
// used in container/agent-runner/prompts/).
const PROMPT_FILES = [
  'interaction.md',
  'skill-routing.md',
  'security-rules.md',
  'memory-system.home.md',
  'memory-system.guest.md',
  'output.md',
  'web-fetch.md',
  'background-tasks.md',
  'agent-override.md',
];
const CHANNEL_FILES = ['feishu.md', 'telegram.md', 'qq.md', 'dingtalk.md'];

let promptsDir: string;
let workspaceDir: string;

function seedPrompts(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'channels'), { recursive: true });
  for (const f of PROMPT_FILES) {
    fs.writeFileSync(path.join(dir, f), `BODY_${f}`);
  }
  for (const f of CHANNEL_FILES) {
    fs.writeFileSync(path.join(dir, 'channels', f), `CHANNEL_${f}`);
  }
}

beforeEach(() => {
  promptsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-prompts-'));
  workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-workspace-'));
  seedPrompts(promptsDir);
});

afterEach(() => {
  try {
    fs.rmSync(promptsDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// Shared model name surfaced in the runtime-identity preamble. Tests use a
// stable value so they can grep for it.
const TEST_MODEL = 'claude-4.6-sonnet-medium';

describe('buildAgentsMd — section selection', () => {
  test('all sections present for home + feishu + override', () => {
    const md = buildAgentsMd({
      isHome: true,
      chatJid: 'feishu:oc_abc',
      hasConversationAgentOverride: true,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    expect(md).toContain('## Runtime identity');
    expect(md).toContain('Cursor backend');
    expect(md).toContain(TEST_MODEL);
    expect(md).toContain('## Interaction');
    expect(md).toContain('BODY_interaction.md');
    expect(md).toContain('## Skill routing');
    expect(md).toContain('## Security');
    expect(md).toContain('## Memory system');
    expect(md).toContain('BODY_memory-system.home.md');
    expect(md).not.toContain('BODY_memory-system.guest.md');
    expect(md).toContain('## Output guidelines');
    expect(md).toContain('## Web fetch');
    expect(md).toContain('## Background tasks');
    expect(md).toContain('## Channel format (feishu)');
    expect(md).toContain('CHANNEL_feishu.md');
    expect(md).toContain('## Conversation agent override');
    expect(md).toContain('BODY_agent-override.md');
  });

  test('guest variant when isHome=false', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:home-1',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    expect(md).toContain('BODY_memory-system.guest.md');
    expect(md).not.toContain('BODY_memory-system.home.md');
  });

  test('memory section omitted when disableMemoryLayer=true', () => {
    const md = buildAgentsMd({
      isHome: true,
      chatJid: 'web:x',
      hasConversationAgentOverride: false,
      disableMemoryLayer: true,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    expect(md).not.toContain('## Memory system');
    expect(md).not.toContain('memory-system.home.md');
    expect(md).not.toContain('memory-system.guest.md');
  });

  test('conversation override section omitted by default', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:x',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    expect(md).not.toContain('## Conversation agent override');
    expect(md).not.toContain('BODY_agent-override.md');
  });

  test('channel section reflects chatJid prefix', () => {
    for (const [jid, expected] of [
      ['feishu:oc_x', 'feishu'],
      ['telegram:-100123', 'telegram'],
      ['qq:111', 'qq'],
      ['dingtalk:cid_x', 'dingtalk'],
    ] as const) {
      const md = buildAgentsMd({
        isHome: false,
        chatJid: jid,
        hasConversationAgentOverride: false,
        disableMemoryLayer: false,
        promptsDir,
        cursorModel: TEST_MODEL,
      });
      expect(md).toContain(`## Channel format (${expected})`);
      expect(md).toContain(`CHANNEL_${expected}.md`);
    }
  });

  test('web channel has no channel-format section', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:home-3',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    expect(md).not.toContain('## Channel format');
  });

  test('discord channel without prompt file → no channel section, no crash', () => {
    // discord.md was never created in seedPrompts; loadOptional must not throw.
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'discord:guild#chan',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    expect(md).not.toContain('## Channel format');
    expect(md).toContain('## Interaction'); // still rendered other sections
  });

  test('header is always present and self-describing', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:x',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    expect(md.startsWith('# HappyClaw Agent Behavior')).toBe(true);
    expect(md).toContain('auto-generated by cursor-runner');
    expect(md).toContain('container/agent-runner/prompts/');
  });
});

describe('buildAgentsMd — runtime identity preamble', () => {
  test('identity is the FIRST section, before any prompts/-sourced one', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:x',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: TEST_MODEL,
    });
    const idxIdentity = md.indexOf('## Runtime identity');
    const idxInteraction = md.indexOf('## Interaction');
    const idxSecurity = md.indexOf('## Security');
    expect(idxIdentity).toBeGreaterThanOrEqual(0);
    expect(idxInteraction).toBeGreaterThan(idxIdentity);
    expect(idxSecurity).toBeGreaterThan(idxIdentity);
  });

  test('identity surfaces the configured model so the LLM cannot guess wrong', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:x',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir,
      cursorModel: 'auto',
    });
    expect(md).toMatch(/## Runtime identity[\s\S]+`auto`/);
    expect(md).toContain('cursor-agent');
    expect(md).toContain('Not the Claude Agent SDK');
  });

  test('identity is emitted even when promptsDir is missing', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:x',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir: '/var/__definitely_not_a_real_path_for_test__',
      cursorModel: TEST_MODEL,
    });
    expect(md).toContain('## Runtime identity');
    expect(md).toContain(TEST_MODEL);
    // No prompt-sourced sections (none could be loaded).
    expect(md).not.toContain('## Interaction');
    expect(md).not.toContain('## Security');
  });
});

describe('buildAgentsMd — degradation', () => {
  test('non-existent promptsDir → identity-only output', () => {
    const md = buildAgentsMd({
      isHome: false,
      chatJid: 'web:x',
      hasConversationAgentOverride: false,
      disableMemoryLayer: false,
      promptsDir: '/var/__definitely_not_a_real_path_for_test__',
      cursorModel: TEST_MODEL,
    });
    // Header + identity must still render so cursor-agent retains identity.
    expect(md).toContain('# HappyClaw Agent Behavior');
    expect(md).toContain('## Runtime identity');
    // No other sections.
    expect(md).not.toContain('## Interaction');
  });

  test('empty prompts dir → identity-only output', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-empty-'));
    try {
      const md = buildAgentsMd({
        isHome: false,
        chatJid: 'web:x',
        hasConversationAgentOverride: false,
        disableMemoryLayer: false,
        promptsDir: empty,
        cursorModel: TEST_MODEL,
      });
      expect(md).toContain('## Runtime identity');
      expect(md).not.toContain('## Interaction');
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  test('partial prompts dir → only present files appear (plus identity)', () => {
    const partial = fs.mkdtempSync(path.join(os.tmpdir(), 'cr-partial-'));
    try {
      fs.writeFileSync(path.join(partial, 'security-rules.md'), 'ONLY_SEC');
      const md = buildAgentsMd({
        isHome: false,
        chatJid: 'web:x',
        hasConversationAgentOverride: false,
        disableMemoryLayer: false,
        promptsDir: partial,
        cursorModel: TEST_MODEL,
      });
      expect(md).toContain('## Runtime identity');
      expect(md).toContain('## Security');
      expect(md).toContain('ONLY_SEC');
      expect(md).not.toContain('## Interaction');
    } finally {
      fs.rmSync(partial, { recursive: true, force: true });
    }
  });
});

describe('writeAgentsMd — atomic write', () => {
  test('writes content to <workspace>/AGENTS.md', () => {
    const bytes = writeAgentsMd(workspaceDir, '# Hello\nbody\n');
    expect(bytes).toBeGreaterThan(0);
    const content = fs.readFileSync(
      path.join(workspaceDir, 'AGENTS.md'),
      'utf-8',
    );
    expect(content).toBe('# Hello\nbody\n');
  });

  test('empty content → no-op (no file created)', () => {
    const bytes = writeAgentsMd(workspaceDir, '');
    expect(bytes).toBe(0);
    expect(fs.existsSync(path.join(workspaceDir, 'AGENTS.md'))).toBe(false);
  });

  test('overwrites existing AGENTS.md atomically', () => {
    fs.writeFileSync(path.join(workspaceDir, 'AGENTS.md'), 'old');
    const bytes = writeAgentsMd(workspaceDir, 'new\n');
    expect(bytes).toBe(4);
    expect(
      fs.readFileSync(path.join(workspaceDir, 'AGENTS.md'), 'utf-8'),
    ).toBe('new\n');
    // No leftover .tmp file.
    expect(fs.existsSync(path.join(workspaceDir, 'AGENTS.md.tmp'))).toBe(false);
  });

  test('creates workspaceGroup dir if missing', () => {
    const fresh = path.join(workspaceDir, 'sub', 'deep');
    expect(fs.existsSync(fresh)).toBe(false);
    writeAgentsMd(fresh, 'X');
    expect(fs.existsSync(path.join(fresh, 'AGENTS.md'))).toBe(true);
  });
});
