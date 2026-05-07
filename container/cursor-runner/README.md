# cursor-runner

happyclaw runner that drives the **Cursor backend** via the `cursor-agent` CLI. Mirrors the stdin/stdout/IPC protocol of [`agent-runner`](../agent-runner) so the host process (`src/container-runner.ts`) can spawn either runner interchangeably — the choice is made per-group via `RegisteredGroup.runtime` (or `User.default_runtime` when unset; see [`src/runtime-resolver.ts`](../../src/runtime-resolver.ts)).

## Build

```bash
npm install
npm run build
```

`make build` from the repo root builds this together with backend / web / agent-runner / happyclaw-mcp-server. `make install` covers the first-time setup.

## Runtime contract

### stdin / stdout / IPC (host-facing)

Identical to agent-runner:

- **stdin**: a single `ContainerInput` JSON, EOF-terminated.
- **stdout**: zero or more `ContainerOutput` JSON objects, each wrapped in `---HAPPYCLAW_OUTPUT_START---` / `---HAPPYCLAW_OUTPUT_END---` lines.
- **IPC** under `<workspaceIpc>/`:
  - `input/*.json` — pending follow-up messages (drained between cursor-agent invocations).
  - `input/_close` — graceful shutdown.
  - `input/_drain` — finish current run then exit.
  - `input/_interrupt` — abort the running cursor-agent (SIGINT to child).
  - `messages/*.json`, `tasks/*.json` — output channels written by happyclaw-mcp-server tools (unchanged from agent-runner contract).

### Environment variables

| Variable | Purpose |
|----------|---------|
| `HAPPYCLAW_WORKSPACE_GROUP` | Group workspace dir (passed to `cursor-agent --workspace`). |
| `HAPPYCLAW_WORKSPACE_IPC` | IPC root (`input/`, `messages/`, `tasks/`, `current-context.json`). |
| `HAPPYCLAW_WORKSPACE_GLOBAL` | Global memory dir (forwarded to happyclaw-mcp-server). |
| `HAPPYCLAW_WORKSPACE_MEMORY` | Per-day memory dir (forwarded to happyclaw-mcp-server). |
| `HAPPYCLAW_MCP_SERVER_DIST` | **Required**: path to `happyclaw-mcp-server/dist/index.js`. Used in the `<workspace>/.cursor/mcp.json` file we write before spawning cursor-agent. |
| `HAPPYCLAW_DISABLE_MEMORY_LAYER` | When `'true'`, skips registering `memory_*` MCP tools. |
| `CURSOR_AGENT_BIN` | Path to `cursor-agent`. Defaults to `cursor-agent` (PATH lookup). |
| `CURSOR_API_KEY` | Optional. cursor-agent prefers OAuth (`cursor-agent login`) but accepts an API key. |
| `CURSOR_MODEL` | Defaults to `claude-4.6-sonnet-medium`. Use `cursor-agent --list-models` for the catalog. |

### How MCP tools reach cursor-agent

cursor-agent does **not** accept an inline `--mcp-config` flag (that flag belongs to the underlying `claude` binary cursor-agent spawns for Anthropic-family models, not to cursor-agent itself). The supported wiring is project-level `<workspace>/.cursor/mcp.json`.

cursor-runner therefore writes (atomically, via tmp + rename) at startup:

```jsonc
// <WORKSPACE_GROUP>/.cursor/mcp.json
{
  "mcpServers": {
    "happyclaw": {
      "type": "stdio",
      "command": "node",
      "args": [
        "<HAPPYCLAW_MCP_SERVER_DIST>",
        "--group-folder", "<groupFolder>",
        "--workspace-group", "<workspaceGroup>",
        "--workspace-ipc", "<workspaceIpc>",
        "--workspace-global", "<workspaceGlobal>",
        "--workspace-memory", "<workspaceMemory>",
        "--chat-jid", "<initial chatJid>",
        "--is-home", "<true|false>",
        "--is-admin-home", "<true|false>"
        // optional: --is-scheduled-task, --disable-memory-layer
      ]
    }
  }
}
```

Project-level `mcp.json` takes precedence over the user-level `~/.cursor/mcp.json`, so this does not interfere with whatever Cursor MCP servers the user has installed for their own IDE work.

The 17 happyclaw tools (`send_message`, `schedule_task`, `memory_*`, `discord_*`, …) become available to cursor-agent under the `mcp__happyclaw__*` namespace, identical to agent-runner.

### Mutable per-turn context

The mutable subset of `McpContext` (chatJid / currentTaskId / isScheduledTask) propagates to happyclaw-mcp-server via `<workspaceIpc>/current-context.json` — atomic-written by both agent-runner and cursor-runner before each turn. happyclaw-mcp-server reads it on every tool call. See [`happyclaw-mcp-server/README.md`](../happyclaw-mcp-server/README.md) for the file format.

## cursor-agent invocation

For each turn:

```bash
cursor-agent \
  --print \
  --output-format=stream-json \
  --stream-partial-output \
  --trust --force \
  --workspace <WORKSPACE_GROUP> \
  --model <CURSOR_MODEL> \
  --approve-mcps \
  [--resume <previous_chat_id>] \
  '<combined prompt>'
```

`--resume <chatId>` is set on every turn after the first. The chat ID is captured from cursor-agent's `system/init` event and surfaced to the host as `ContainerOutput.newSessionId` so the host persists it as `sessions.cursor_chat_id`.

## stream-json → happyclaw StreamEvent translation

| cursor-agent stream-json | happyclaw StreamEvent | Notes |
|---|---|---|
| `system/init` | `init` | Sets sessionId; statusText reports model. |
| `user` (echo) | (dropped) | Cursor echoes the prompt; we already sent it. |
| `assistant` with `timestamp_ms` | `text_delta` | Streaming chunk. |
| `assistant` without `timestamp_ms` | (dropped) | Final consolidated message; same content as preceding deltas. |
| `tool_call.started` | `tool_use_start` | Tool name extracted from key suffix (`<name>ToolCall` → `<Name>` for built-ins, `mcp__…` preserved). |
| `tool_call.completed` | `tool_use_end` | `statusText='success'\|'error'` based on result.error presence. |
| `result.success` | `success` ContainerOutput + `usage` event | sourceKind=`sdk_final`, finalizationReason=`completed`. |
| `result.error_*` | `error` ContainerOutput | finalizationReason=`error`. |

## What this Step intentionally does NOT implement

- **PreCompact hook / memory flush** — Cursor does not expose compaction events. Step 5 will add a token-threshold-based trigger.
- **Streaming user messages mid-query** — cursor-agent CLI accepts a single prompt per invocation. Follow-ups queue via IPC and are combined into the next `--resume` invocation.
- **Image attachments in prompts** — cursor-agent has no documented image flag. Step 5 will route via workspace files + reference.
- **Sub-agent transcript extraction / session-history fallback** — Cursor's persistence model differs from Claude's `.claude/projects/*.jsonl`; we rely on `--resume <chatId>` and accept that resume failure starts a fresh chat.

## Verification (Step 3 e2e probe)

```bash
mkdir -p /tmp/cr-probe/{ipc/input,group,global,memory}
cat > /tmp/cr-probe-input.json <<'EOF'
{"prompt":"Reply with exactly: STEP3_PROBE_OK","groupFolder":"cr-probe","chatJid":"web:cr-probe","isHome":false,"isAdminHome":false,"isScheduledTask":false,"turnId":"t1"}
EOF
HAPPYCLAW_WORKSPACE_GROUP=/tmp/cr-probe/group \
HAPPYCLAW_WORKSPACE_GLOBAL=/tmp/cr-probe/global \
HAPPYCLAW_WORKSPACE_MEMORY=/tmp/cr-probe/memory \
HAPPYCLAW_WORKSPACE_IPC=/tmp/cr-probe/ipc \
HAPPYCLAW_MCP_SERVER_DIST="$PWD/container/happyclaw-mcp-server/dist/index.js" \
  node container/cursor-runner/dist/index.js < /tmp/cr-probe-input.json
# Expect: init / text_delta / sdk_final ContainerOutput in OUTPUT_MARKER frames
# Then: write `touch /tmp/cr-probe/ipc/input/_close` to make it exit
```
