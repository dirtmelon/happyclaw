# happyclaw-mcp-server

Standalone stdio MCP server exposing the 17 built-in HappyClaw tools (`send_message`, `schedule_task`, `memory_*`, etc.).

Consumed by:

- **agent-runner** (Claude path) via `mcpServers.happyclaw = { command, args }` — default since the migration from same-process `createSdkMcpServer()` registration.
- **cursor-runner** (future Cursor path) — same stdio entry, configured via `.cursor/mcp.json` or `--mcp-config` so both backends share the exact same tool surface.

## Build

```bash
npm install
npm run build
```

`make build` from the repo root builds this together with backend / web / agent-runner. `make install` also runs once on first checkout.

## Runtime contract

### Startup arguments

The server is spawned as a child process by agent-runner / cursor-runner with these CLI flags:

| Flag | Required | Type | Description |
|------|----------|------|-------------|
| `--group-folder` | yes | string | Workspace folder name, e.g. `home-42` or `main` |
| `--workspace-group` | yes | path | Mount path of the group workspace (`/workspace/group` in container) |
| `--workspace-ipc` | yes | path | IPC root, holds `messages/`, `tasks/`, and the mutable `current-context.json` |
| `--workspace-global` | yes | path | Global memory directory |
| `--workspace-memory` | yes | path | Per-day memory directory |
| `--chat-jid` | no | string | Initial fallback chatJid until the first context file write |
| `--is-home` | no | bool | True for the user's home container (admin or member) |
| `--is-admin-home` | no | bool | True only for admin's main container |
| `--is-scheduled-task` | no | flag | Initial scheduled-task flag (overridden by context file per turn) |
| `--disable-memory-layer` | no | flag | Skip registering `memory_append` / `memory_search` / `memory_get` |

stderr carries diagnostic logs only. Stdout is reserved for the MCP JSON-RPC channel.

### Mutable context file

Most static context (workspaces, isHome, etc.) is fixed at startup. Three fields change between IPC turns and are loaded from `<workspaceIpc>/current-context.json` on every tool call:

- `chatJid` — the IM chat that triggered the current turn (e.g. `feishu:oc_xxx`, `web:home-42`)
- `currentTaskId` — present when the turn was triggered by a scheduled task; absent for regular user turns
- `isScheduledTask` — boolean; controls whether `send_message` stamps the IPC payload as task-broadcast

agent-runner writes the file atomically (`tmp + rename`) before each turn. The MCP server reads it on every `tools/call`. If the file is missing, unreadable, or contains invalid JSON, the server silently falls back to the static defaults captured from CLI flags — IO errors must never break a tool call.

## Tools

All 17 tools mirror the legacy in-process registration in `container/agent-runner/src/mcp-tools.ts` byte-for-byte where possible. Conditional registration is preserved:

- `install_skill`, `uninstall_skill` — only when `--is-home` is set
- `memory_append` — only when `--is-home` and `--disable-memory-layer` is NOT set
- `memory_search`, `memory_get` — only when `--disable-memory-layer` is NOT set
- All other 12 tools — always registered

## Rolling back to in-process MCP

Set `HAPPYCLAW_USE_LEGACY_MCP=1` in the runner environment to skip this stdio server and fall back to the in-process `createSdkMcpServer()` registration in agent-runner. The legacy path is kept for one release cycle so emergencies have a documented escape hatch; it will be removed once the stdio path proves stable.

## Tests

- `tests/mcp-send-message-taskid.test.ts` — pins the IPC payload contract for `buildSendMessageData` (re-exported from `tools.ts`)
- `tests/units/mcp-context-file.test.ts` — pins the static + mutable context merge, file-IO safety, and CLI flag parsing
