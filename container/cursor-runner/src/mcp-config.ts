/**
 * Build a `.cursor/mcp.json` file that cursor-agent picks up when invoked
 * with `--workspace=<WORKSPACE_GROUP>` (project-level MCP config takes
 * precedence over `~/.cursor/mcp.json`). cursor-agent does NOT accept an
 * inline `--mcp-config` flag — that flag belongs to the underlying claude
 * binary spawned for Claude-family models, not to cursor-agent itself.
 *
 * Verified against cursor-agent 2026.03.20: passing `--mcp-config` causes
 * `error: unknown option '--mcp-config'` immediately. Project-level
 * `<workspace>/.cursor/mcp.json` is the supported alternative and is loaded
 * once at cursor-agent startup.
 *
 * The args list is identical to the one agent-runner uses to spawn the
 * standalone happyclaw-mcp-server, so a single tool surface (17 tools) backs
 * both runners. There is no legacy in-process fallback here — Cursor CLI
 * cannot host the server in-process the way `createSdkMcpServer()` does for
 * Claude SDK, so the stdio path is the only path. Setting
 * `HAPPYCLAW_USE_LEGACY_MCP=1` has no effect on the Cursor backend.
 */
import fs from 'fs';
import path from 'path';

import type { ContainerInput } from './types.js';

export interface McpConfigContext {
  groupFolder: string;
  workspaceGroup: string;
  workspaceIpc: string;
  workspaceGlobal: string;
  workspaceMemory: string;
  isHome: boolean;
  isAdminHome: boolean;
  isScheduledTask: boolean;
  disableMemoryLayer: boolean;
  /** Initial chatJid the MCP server falls back to before the first per-turn
   * `current-context.json` write. */
  chatJid: string;
}

/** JSON config object Cursor expects for inline `--mcp-config`. */
export interface CursorMcpConfig {
  mcpServers: {
    happyclaw: {
      type: 'stdio';
      command: string;
      args: string[];
    };
  };
}

export function buildHappyclawMcpConfig(
  mcpServerDistPath: string,
  ctx: McpConfigContext,
): CursorMcpConfig {
  const args: string[] = [
    path.resolve(mcpServerDistPath),
    '--group-folder',
    ctx.groupFolder,
    '--workspace-group',
    ctx.workspaceGroup,
    '--workspace-ipc',
    ctx.workspaceIpc,
    '--workspace-global',
    ctx.workspaceGlobal,
    '--workspace-memory',
    ctx.workspaceMemory,
    '--chat-jid',
    ctx.chatJid,
    '--is-home',
    String(ctx.isHome),
    '--is-admin-home',
    String(ctx.isAdminHome),
  ];
  if (ctx.isScheduledTask) args.push('--is-scheduled-task');
  if (ctx.disableMemoryLayer) args.push('--disable-memory-layer');

  return {
    mcpServers: {
      happyclaw: {
        type: 'stdio',
        command: 'node',
        args,
      },
    },
  };
}

/**
 * Build the McpConfigContext from a ContainerInput + workspace paths. Helper
 * to keep `index.ts` thin — every flag mirrors `agent-runner`'s identical
 * field so cursor-runner spawns happyclaw-mcp-server with the exact same
 * static context shape.
 */
export function mcpConfigContextFromInput(
  input: ContainerInput,
  paths: {
    workspaceGroup: string;
    workspaceIpc: string;
    workspaceGlobal: string;
    workspaceMemory: string;
  },
  flags: { disableMemoryLayer: boolean },
): McpConfigContext {
  return {
    groupFolder: input.groupFolder,
    workspaceGroup: paths.workspaceGroup,
    workspaceIpc: paths.workspaceIpc,
    workspaceGlobal: paths.workspaceGlobal,
    workspaceMemory: paths.workspaceMemory,
    isHome: !!input.isHome,
    isAdminHome: !!input.isAdminHome,
    isScheduledTask: !!input.isScheduledTask,
    disableMemoryLayer: flags.disableMemoryLayer,
    chatJid: input.currentSourceJid || input.chatJid,
  };
}

/**
 * Atomically write `.cursor/mcp.json` under `workspaceGroup` so cursor-agent
 * picks it up on its next `--workspace=<workspaceGroup>` invocation.
 *
 * Idempotent: existing file is overwritten only when content differs (avoids
 * spurious mtime churn that could confuse Cursor's file watchers).
 */
export function writeWorkspaceMcpConfig(
  workspaceGroup: string,
  mcpServerDistPath: string,
  ctx: McpConfigContext,
): void {
  const cfgDir = path.join(workspaceGroup, '.cursor');
  const cfgPath = path.join(cfgDir, 'mcp.json');
  fs.mkdirSync(cfgDir, { recursive: true });
  const config = buildHappyclawMcpConfig(mcpServerDistPath, ctx);
  const newContent = JSON.stringify(config, null, 2) + '\n';
  try {
    if (fs.existsSync(cfgPath)) {
      const current = fs.readFileSync(cfgPath, 'utf-8');
      if (current === newContent) return;
    }
  } catch {
    /* fall through to write */
  }
  const tmp = cfgPath + '.tmp';
  fs.writeFileSync(tmp, newContent);
  fs.renameSync(tmp, cfgPath);
}
