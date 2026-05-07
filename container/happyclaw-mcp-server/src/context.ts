/**
 * Context handling for happyclaw-mcp-server.
 *
 * Static context (workspace paths, isHome flags, groupFolder, etc.) is parsed
 * once at startup from CLI flags. Dynamic context (chatJid, currentTaskId,
 * isScheduledTask) is loaded on every tool invocation from a shared file
 * `<workspaceIpc>/current-context.json` that the agent-runner main process
 * atomic-writes between IPC turns.
 *
 * If the dynamic context file is missing or unparseable, we fall back to the
 * static defaults captured at startup (chatJid from --chat-jid, currentTaskId
 * = null). This keeps tool calls safe during the brief window between server
 * boot and the first context write, and during transient FS errors.
 */
import fs from 'fs';
import path from 'path';

const MUTABLE_CONTEXT_FILENAME = 'current-context.json';

export interface StaticContext {
  groupFolder: string;
  isHome: boolean;
  isAdminHome: boolean;
  workspaceIpc: string;
  workspaceGroup: string;
  workspaceGlobal: string;
  workspaceMemory: string;
  disableMemoryLayer: boolean;
  /** Initial chatJid captured at startup; replaced per-turn by the mutable
   * context file. Used as fallback when the file is absent. */
  initialChatJid: string;
  /** Initial isScheduledTask flag from CLI; replaced per-turn by the
   * mutable context file. Used as fallback when the file is absent. */
  initialIsScheduledTask: boolean;
}

export interface MutableContext {
  chatJid?: string;
  currentTaskId?: string | null;
  isScheduledTask?: boolean;
}

/**
 * Effective context passed to each tool handler. Mirrors the McpContext shape
 * used by the in-process tools so the migration of tool bodies is a near-noop.
 */
export interface McpContext {
  chatJid: string;
  groupFolder: string;
  isHome: boolean;
  isAdminHome: boolean;
  isScheduledTask: boolean;
  currentTaskId: string | null;
  workspaceIpc: string;
  workspaceGroup: string;
  workspaceGlobal: string;
  workspaceMemory: string;
  disableMemoryLayer: boolean;
}

interface ParsedFlags {
  flags: Map<string, string>;
  bools: Set<string>;
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const name = arg.slice(2);
    const eq = name.indexOf('=');
    if (eq >= 0) {
      flags.set(name.slice(0, eq), name.slice(eq + 1));
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      bools.add(name);
      continue;
    }
    flags.set(name, next);
    i++;
  }
  return { flags, bools };
}

function requireFlag(parsed: ParsedFlags, name: string): string {
  const v = parsed.flags.get(name);
  if (v === undefined || v === '') {
    throw new Error(`Missing required flag --${name}`);
  }
  return v;
}

function optionalFlag(parsed: ParsedFlags, name: string): string | undefined {
  const v = parsed.flags.get(name);
  return v === '' ? undefined : v;
}

function boolFlag(parsed: ParsedFlags, name: string, defaultValue = false): boolean {
  if (parsed.bools.has(name)) return true;
  const v = parsed.flags.get(name);
  if (v === undefined) return defaultValue;
  return v === 'true' || v === '1';
}

/**
 * Parse static context from process argv (ignores argv[0] / argv[1] = node + script).
 *
 * Required flags: --group-folder, --workspace-group, --workspace-ipc,
 *                 --workspace-global, --workspace-memory
 * Boolean flags:  --is-home, --is-admin-home, --is-scheduled-task,
 *                 --disable-memory-layer
 * Optional:       --chat-jid (initial fallback)
 */
export function parseStaticContext(argv: string[]): StaticContext {
  const parsed = parseFlags(argv.slice(2));
  return {
    groupFolder: requireFlag(parsed, 'group-folder'),
    workspaceGroup: requireFlag(parsed, 'workspace-group'),
    workspaceIpc: requireFlag(parsed, 'workspace-ipc'),
    workspaceGlobal: requireFlag(parsed, 'workspace-global'),
    workspaceMemory: requireFlag(parsed, 'workspace-memory'),
    isHome: boolFlag(parsed, 'is-home'),
    isAdminHome: boolFlag(parsed, 'is-admin-home'),
    initialIsScheduledTask: boolFlag(parsed, 'is-scheduled-task'),
    disableMemoryLayer: boolFlag(parsed, 'disable-memory-layer'),
    initialChatJid: optionalFlag(parsed, 'chat-jid') ?? '',
  };
}

/**
 * Read the mutable context file. Returns an empty object when the file is
 * missing, unreadable, or contains invalid JSON. Never throws — tool calls
 * must never break because of context-file IO.
 */
export function loadMutableContext(workspaceIpc: string): MutableContext {
  const file = path.join(workspaceIpc, MUTABLE_CONTEXT_FILENAME);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const obj = parsed as Record<string, unknown>;
    const out: MutableContext = {};
    if (typeof obj.chatJid === 'string') out.chatJid = obj.chatJid;
    if (obj.currentTaskId === null || typeof obj.currentTaskId === 'string') {
      out.currentTaskId = obj.currentTaskId as string | null;
    }
    if (typeof obj.isScheduledTask === 'boolean') {
      out.isScheduledTask = obj.isScheduledTask;
    }
    return out;
  } catch {
    return {};
  }
}

/** Merge static + mutable context into the McpContext shape used by tool handlers. */
export function buildMcpContext(staticCtx: StaticContext): McpContext {
  const mutable = loadMutableContext(staticCtx.workspaceIpc);
  return {
    chatJid: mutable.chatJid ?? staticCtx.initialChatJid,
    groupFolder: staticCtx.groupFolder,
    isHome: staticCtx.isHome,
    isAdminHome: staticCtx.isAdminHome,
    isScheduledTask: mutable.isScheduledTask ?? staticCtx.initialIsScheduledTask,
    currentTaskId: mutable.currentTaskId ?? null,
    workspaceIpc: staticCtx.workspaceIpc,
    workspaceGroup: staticCtx.workspaceGroup,
    workspaceGlobal: staticCtx.workspaceGlobal,
    workspaceMemory: staticCtx.workspaceMemory,
    disableMemoryLayer: staticCtx.disableMemoryLayer,
  };
}

export const MUTABLE_CONTEXT_FILENAME_EXPORT = MUTABLE_CONTEXT_FILENAME;
