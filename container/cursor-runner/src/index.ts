#!/usr/bin/env node
/**
 * cursor-runner — happyclaw runner that drives the Cursor backend via the
 * cursor-agent CLI. Mirrors the stdin/stdout/IPC protocol of agent-runner so
 * the host (`src/container-runner.ts`) can spawn either runner
 * interchangeably.
 *
 * Lifecycle:
 *   1. Read full ContainerInput JSON from stdin (single read, EOF-terminated).
 *   2. Drain any IPC input/*.json present at startup, append to prompt.
 *   3. Spawn `cursor-agent --print --output-format=stream-json …` with that
 *      prompt + `--resume <chatId>` if a Cursor chat ID is carried in
 *      ContainerInput.sessionId.
 *   4. Parse stdout line-by-line through CursorStreamTranslator → emit
 *      OUTPUT_MARKER-wrapped ContainerOutput JSON to OUR stdout (so the host
 *      sees the same protocol as agent-runner).
 *   5. When cursor-agent exits, emit a final session-update output, then wait
 *      for the next IPC message (or `_close` / `_drain` sentinel).
 *
 * Differences from agent-runner intentionally NOT implemented in this Step:
 *   - PreCompact hook / memory flush — Cursor does not expose compaction
 *     events. Step 5 will install a token-threshold-based equivalent.
 *   - Streaming user messages mid-query — cursor-agent CLI accepts a single
 *     prompt per invocation. Follow-up messages queue between invocations.
 *   - Sub-agent transcript extraction — Cursor's persistence model differs;
 *     handled later if needed.
 *
 * stderr is reserved for diagnostic logging only. stdout MUST be the
 * OUTPUT_MARKER protocol channel.
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  mcpConfigContextFromInput,
  writeWorkspaceMcpConfig,
} from './mcp-config.js';
import { buildAgentsMd, writeAgentsMd } from './build-agents-md.js';
import { combineMessages, IpcChannel, type PendingMessage } from './ipc.js';
import {
  buildArchiveMarkdown,
  createState as createCompactState,
  defaultArchiveName,
  pushTurn,
  resetState,
  shouldCompact,
  writeArchive,
} from './auto-compact.js';
import {
  appendAttachmentReferences,
  writeImageAttachments,
} from './attachments.js';
import { CursorStreamTranslator } from './stream-translator.js';
import type {
  ContainerInput,
  ContainerOutput,
  CursorStreamMessage,
  StreamEvent,
} from './types.js';

const OUTPUT_START_MARKER = '---HAPPYCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---HAPPYCLAW_OUTPUT_END---';

// Workspace paths — match agent-runner conventions exactly so the host can
// inject env identically (HAPPYCLAW_WORKSPACE_GROUP / IPC / GLOBAL / MEMORY).
const WORKSPACE_GROUP =
  process.env.HAPPYCLAW_WORKSPACE_GROUP || '/workspace/group';
const WORKSPACE_GLOBAL =
  process.env.HAPPYCLAW_WORKSPACE_GLOBAL || '/workspace/global';
const WORKSPACE_MEMORY =
  process.env.HAPPYCLAW_WORKSPACE_MEMORY || '/workspace/memory';
const WORKSPACE_IPC = process.env.HAPPYCLAW_WORKSPACE_IPC || '/workspace/ipc';

const MCP_SERVER_DIST = process.env.HAPPYCLAW_MCP_SERVER_DIST || '';
const CURSOR_AGENT_BIN = process.env.CURSOR_AGENT_BIN || 'cursor-agent';

// Path to `container/agent-runner/prompts/` — set by container-runner.ts so
// cursor-runner can render `<workspaceGroup>/AGENTS.md` from the same source
// of truth as agent-runner's systemPrompt.append.
const PROMPTS_DIR = process.env.HAPPYCLAW_PROMPTS_DIR || '';

// CURSOR_MODEL must be set by the host (src/container-runner.ts) which
// resolves the per-group / per-user model via `resolveCursorModel()` and
// writes it to the runner env before spawning. We removed the hard-coded
// fallback (was `'claude-opus-4-7-thinking-max'`) to eliminate the second
// source-of-truth for the default model — drift between the two definitions
// would silently use a different model in dev vs prod.
//
// For ad-hoc dev runs that invoke this binary directly, set CURSOR_MODEL
// explicitly: `CURSOR_MODEL=claude-opus-4-7-thinking-max node dist/index.js`.
if (!process.env.CURSOR_MODEL) {
  process.stderr.write(
    '[cursor-runner] FATAL: CURSOR_MODEL environment variable is required.\n' +
      'When started by the happyclaw host, this is injected by container-runner.ts ' +
      '(resolveCursorModel → groupOverride/userDefault/env/HARDCODED_DEFAULT).\n' +
      'For ad-hoc dev runs, export CURSOR_MODEL manually before invoking.\n',
  );
  process.exit(2);
}
const CURSOR_MODEL = process.env.CURSOR_MODEL;

// MCP context-file (mutable subset shared with happyclaw-mcp-server).
// Same path as agent-runner's writeMcpContext target so per-turn updates can
// originate from this runner without coordination.
const MCP_CONTEXT_FILE = path.join(WORKSPACE_IPC, 'current-context.json');

const DISABLE_MEMORY_LAYER =
  process.env.HAPPYCLAW_DISABLE_MEMORY_LAYER === 'true';

function log(message: string): void {
  process.stderr.write(`[cursor-runner] ${message}\n`);
}

function writeOutput(out: ContainerOutput): void {
  process.stdout.write(`${OUTPUT_START_MARKER}\n${JSON.stringify(out)}\n${OUTPUT_END_MARKER}\n`);
}

/** Atomic-write the mutable MCP context file so happyclaw-mcp-server picks
 * up the latest chatJid / currentTaskId / isScheduledTask on its next tool
 * call. Mirrors agent-runner's writeMcpContext shape exactly. */
function writeMcpContext(snapshot: {
  chatJid: string;
  currentTaskId: string | null;
  isScheduledTask: boolean;
}): void {
  try {
    fs.mkdirSync(WORKSPACE_IPC, { recursive: true });
    const tmp = MCP_CONTEXT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot));
    fs.renameSync(tmp, MCP_CONTEXT_FILE);
  } catch (err) {
    log(`writeMcpContext failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function generateTurnId(): string {
  return `cur-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

interface CursorRunResult {
  /** session_id reported by cursor-agent (use as next --resume arg). */
  sessionId: string | undefined;
  /** Whether the run was interrupted by `_interrupt` sentinel. */
  interrupted: boolean;
  /** Whether `_close` / `_drain` was consumed during the run (caller exits). */
  closedDuringRun: boolean;
  /** Whether the run actually emitted a result (vs aborted before any). */
  emittedResult: boolean;
  /** Final assistant text from this turn (echoed back so the main loop can
   * append it to the auto-compact conversation log). Empty string when no
   * result reached the translator. */
  finalText: string;
  /** Per-turn token totals reported by cursor-agent's `result.usage`. Both
   * fields default to 0 when usage is missing. */
  inputTokens: number;
  outputTokens: number;
}

interface RunOpts {
  prompt: string;
  resumeChatId: string | undefined;
  containerInput: ContainerInput;
  ipc: IpcChannel;
  workspace: string;
  /** stdin for cursor-agent — used when prompt is too long for argv. */
  promptViaStdin: boolean;
}

/**
 * Run cursor-agent once and stream its stdout through the translator.
 * Returns when cursor-agent exits (normally, on error, or via interrupt).
 *
 * MCP servers are loaded from `<workspace>/.cursor/mcp.json` which is
 * written by writeWorkspaceMcpConfig() before main loop starts. cursor-agent
 * does NOT accept inline `--mcp-config`; project-level mcp.json is the only
 * supported wiring.
 */
async function runCursorAgent(opts: RunOpts): Promise<CursorRunResult> {
  const args: string[] = [
    '--print',
    '--output-format=stream-json',
    '--stream-partial-output',
    '--trust',
    '--force',
    '--workspace',
    opts.workspace,
    '--model',
    CURSOR_MODEL,
    '--approve-mcps',
  ];
  if (opts.resumeChatId) {
    args.push('--resume', opts.resumeChatId);
  }
  if (!opts.promptViaStdin) {
    args.push(opts.prompt);
  }

  log(
    `Spawning cursor-agent: model=${CURSOR_MODEL} resume=${opts.resumeChatId ?? '(new)'} prompt_len=${opts.prompt.length}`,
  );
  const child: ChildProcess = spawn(CURSOR_AGENT_BIN, args, {
    stdio: [opts.promptViaStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  if (opts.promptViaStdin && child.stdin) {
    child.stdin.write(opts.prompt);
    child.stdin.end();
  }

  const turnId = opts.containerInput.turnId || generateTurnId();
  const translator = new CursorStreamTranslator(
    { turnId, sessionId: opts.resumeChatId },
    {
      emitStreamEvent: (event: StreamEvent) => {
        writeOutput({
          status: 'stream',
          result: null,
          streamEvent: event,
          turnId,
          sessionId: event.sessionId,
        });
      },
      emitFinal: ({ text, sessionId, usage }) => {
        // Capture for the main loop's auto-compact bookkeeping.
        finalText = text;
        if (usage) {
          inputTokens = usage.inputTokens ?? 0;
          outputTokens = usage.outputTokens ?? 0;
        }
        writeOutput({
          status: 'success',
          result: text,
          newSessionId: sessionId,
          turnId,
          sessionId,
          sourceKind: 'sdk_final',
          finalizationReason: 'completed',
        });
        // Emit usage as a stream event so the host can persist token totals.
        if (usage) {
          writeOutput({
            status: 'stream',
            result: null,
            turnId,
            sessionId,
            streamEvent: {
              eventType: 'usage',
              turnId,
              sessionId,
              usage: {
                inputTokens: usage.inputTokens ?? 0,
                outputTokens: usage.outputTokens ?? 0,
                cacheReadInputTokens: usage.cacheReadTokens ?? 0,
                cacheCreationInputTokens: usage.cacheWriteTokens ?? 0,
                costUSD: 0, // Cursor stream-json does not expose cost
                durationMs: usage.durationMs ?? 0,
                numTurns: 1,
                modelUsage: {
                  [CURSOR_MODEL]: {
                    inputTokens: usage.inputTokens ?? 0,
                    outputTokens: usage.outputTokens ?? 0,
                    cacheReadInputTokens: usage.cacheReadTokens ?? 0,
                    cacheCreationInputTokens: usage.cacheWriteTokens ?? 0,
                    costUSD: 0,
                  },
                },
              },
            },
          });
        }
      },
      emitError: ({ error, sessionId }) => {
        writeOutput({
          status: 'error',
          result: null,
          error,
          newSessionId: sessionId,
          turnId,
          sessionId,
          finalizationReason: 'error',
        });
      },
      log,
    },
  );

  let interrupted = false;
  let closedDuringRun = false;
  let emittedResult = false;
  let finalText = '';
  let inputTokens = 0;
  let outputTokens = 0;

  // Watch for sentinels while cursor-agent runs. We poll every 250ms (cheap)
  // since cursor-agent stream output is the dominant signal anyway.
  const sentinelPoll = setInterval(() => {
    if (opts.ipc.consumeInterrupt()) {
      interrupted = true;
      log('Interrupt sentinel received, killing cursor-agent (SIGINT)');
      try {
        child.kill('SIGINT');
      } catch {
        /* ignore */
      }
      // Force-kill if not gone within 5s.
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* ignore */
          }
        }
      }, 5_000);
    }
    if (opts.ipc.consumeClose()) {
      closedDuringRun = true;
      log('_close sentinel during cursor-agent run');
      try {
        child.kill('SIGINT');
      } catch {
        /* ignore */
      }
    }
  }, 250);

  // Pipe stderr of cursor-agent to our stderr (prefixed) for debuggability.
  child.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString('utf8').split('\n');
    for (const line of lines) {
      if (line.trim().length > 0) process.stderr.write(`[cursor-agent] ${line}\n`);
    }
  });

  // Parse stdout as JSON-per-line. cursor-agent always emits one JSON object
  // per line; partial lines may arrive in chunks across `data` events, so we
  // buffer until we see a newline.
  let buf = '';
  await new Promise<void>((resolve) => {
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let parsed: CursorStreamMessage;
        try {
          parsed = JSON.parse(line) as CursorStreamMessage;
        } catch (err) {
          log(
            `Failed to parse cursor-agent line (skipped): ${err instanceof Error ? err.message : String(err)} :: ${line.slice(0, 200)}`,
          );
          continue;
        }
        const isTerminal = translator.process(parsed);
        if (isTerminal) emittedResult = true;
      }
    });
    child.on('close', () => {
      // Drain any trailing buffered text (no trailing newline).
      if (buf.trim()) {
        try {
          const parsed = JSON.parse(buf) as CursorStreamMessage;
          if (translator.process(parsed)) emittedResult = true;
        } catch {
          /* ignore */
        }
      }
      resolve();
    });
    child.on('error', (err) => {
      log(`cursor-agent spawn error: ${err.message}`);
      resolve();
    });
  });

  clearInterval(sentinelPoll);

  if (interrupted) {
    writeOutput({
      status: 'stream',
      result: null,
      streamEvent: {
        eventType: 'status',
        turnId,
        sessionId: translator.getSessionId(),
        statusText: 'interrupted',
      },
      turnId,
      sessionId: translator.getSessionId(),
    });
  }

  return {
    sessionId: translator.getSessionId(),
    interrupted,
    closedDuringRun,
    emittedResult,
    finalText,
    inputTokens,
    outputTokens,
  };
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;
  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  if (!MCP_SERVER_DIST) {
    writeOutput({
      status: 'error',
      result: null,
      error:
        'HAPPYCLAW_MCP_SERVER_DIST not set. cursor-runner requires happyclaw-mcp-server stdio path.',
    });
    process.exit(2);
  }

  const ipc = new IpcChannel(WORKSPACE_IPC);
  ipc.ensureDir();

  // Write `<WORKSPACE_GROUP>/.cursor/mcp.json` so cursor-agent picks up the
  // happyclaw stdio MCP server on every `--workspace=…` invocation. The
  // mutable bits (chatJid / currentTaskId / isScheduledTask) propagate via
  // the separate `current-context.json` file — see writeMcpContext.
  const mcpCtx = mcpConfigContextFromInput(
    containerInput,
    {
      workspaceGroup: WORKSPACE_GROUP,
      workspaceIpc: WORKSPACE_IPC,
      workspaceGlobal: WORKSPACE_GLOBAL,
      workspaceMemory: WORKSPACE_MEMORY,
    },
    { disableMemoryLayer: DISABLE_MEMORY_LAYER },
  );
  try {
    writeWorkspaceMcpConfig(WORKSPACE_GROUP, MCP_SERVER_DIST, mcpCtx);
    log(
      `MCP config written to ${WORKSPACE_GROUP}/.cursor/mcp.json (stdio child via ${MCP_SERVER_DIST})`,
    );
  } catch (err) {
    log(
      `Failed to write .cursor/mcp.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Track the current chat session ID across turns. cursor-agent reports a
  // fresh session_id on first run; subsequent turns pass it via --resume.
  let currentChatId: string | undefined = containerInput.sessionId;
  // Persistent per-turn mutable context.
  let currentChatJid =
    containerInput.currentSourceJid || containerInput.chatJid;
  let currentTaskId: string | null = containerInput.messageTaskId ?? null;
  let currentIsScheduled = !!containerInput.isScheduledTask;
  writeMcpContext({
    chatJid: currentChatJid,
    currentTaskId,
    isScheduledTask: currentIsScheduled,
  });

  // Render `<WORKSPACE_GROUP>/AGENTS.md` from the per-turn ctx. cursor-agent
  // auto-loads this file on `--workspace=...` startup, giving the Cursor
  // backend the same behavior guidance agent-runner gets via
  // `systemPrompt.append`. Re-rendered before each cursor-agent run because
  // `chatJid` (channel section) and `agentId` (override section) can change
  // between turns.
  const refreshAgentsMd = (): void => {
    // No prompts dir is fine: buildAgentsMd always emits at least the
    // runtime-identity preamble so cursor-agent learns it is the cursor stack.
    try {
      const content = buildAgentsMd({
        isHome: !!containerInput.isHome,
        chatJid: currentChatJid,
        hasConversationAgentOverride: !!containerInput.agentId,
        disableMemoryLayer: DISABLE_MEMORY_LAYER,
        promptsDir: PROMPTS_DIR,
        cursorModel: CURSOR_MODEL,
      });
      const bytes = writeAgentsMd(WORKSPACE_GROUP, content);
      if (bytes > 0) {
        log(`AGENTS.md refreshed (${bytes} bytes, channel=${currentChatJid.split(':')[0] || 'web'})`);
      }
    } catch (err) {
      log(
        `AGENTS.md write failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  refreshAgentsMd();

  // Auto-compact bookkeeping. Disabled when CURSOR_AUTO_COMPACT_TOKENS is
  // unset or <= 0; otherwise cumulative tokens across turns are checked
  // after each turn and an archive is written when the threshold is hit.
  const compactThreshold = (() => {
    const raw = parseInt(process.env.CURSOR_AUTO_COMPACT_TOKENS ?? '0', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  })();
  const compactState = createCompactState();
  if (compactThreshold > 0) {
    log(`Auto-compact enabled: threshold=${compactThreshold} tokens`);
  }

  // Build initial prompt: original prompt + drained pending IPC messages.
  let prompt = containerInput.prompt;
  let promptImages = containerInput.images;
  if (containerInput.isScheduledTask) {
    prompt =
      [
        '[定时任务 - 以下内容由系统自动发送，并非来自用户或群组的直接消息。]',
        '',
        '重要：你正在定时任务模式下运行。你的最终输出不会自动发送给用户。你必须使用 mcp__happyclaw__send_message 工具来发送消息，否则用户将收不到任何内容。',
        '',
        '注意：只在完成任务后调用一次 send_message 发送最终结果，不要发送中间状态或重复消息。',
      ].join('\n') +
      '\n\n' +
      prompt;
  }
  const initialDrain = ipc.drain(log);
  if (initialDrain.messages.length > 0) {
    log(`Draining ${initialDrain.messages.length} pending IPC messages into initial prompt`);
    const combined = combineMessages(initialDrain.messages);
    prompt += '\n' + combined.text;
    if (combined.taskId) currentTaskId = combined.taskId;
    if (combined.sourceJid) currentChatJid = combined.sourceJid;
    if (combined.images.length > 0) {
      promptImages = [...(promptImages ?? []), ...combined.images];
    }
    if (currentTaskId !== null || combined.sourceJid) {
      writeMcpContext({
        chatJid: currentChatJid,
        currentTaskId,
        isScheduledTask: currentIsScheduled,
      });
    }
  }
  // Image attachments: cursor-agent CLI takes only a single text prompt.
  // We materialize each image as a workspace file under .cr-attachments/
  // and append a reference footer so cursor-agent's vision-capable model
  // can route them through its built-in tools. See attachments.ts.
  const ensureAttachmentsForTurn = (): void => {
    if (!promptImages || promptImages.length === 0) return;
    const turnId = containerInput.turnId || generateTurnId();
    const written = writeImageAttachments(
      WORKSPACE_GROUP,
      turnId,
      promptImages,
      log,
    );
    if (written.length > 0) {
      prompt = appendAttachmentReferences(prompt, written);
      log(
        `Attachments: ${written.length} image(s) staged at .cr-attachments/${turnId}/ ` +
        `(${written.map((a) => a.mimeType).join(', ')})`,
      );
    }
    // Clear so a follow-up turn doesn't re-stage the same images on top of
    // its own; the next IPC message replaces promptImages anyway.
    promptImages = undefined;
  };
  ensureAttachmentsForTurn();

  // Heuristic: prompts longer than ~100KB are sent via stdin to avoid hitting
  // ARG_MAX on macOS. cursor-agent accepts neither stdin nor a file flag in
  // its public --help; if stdin path is broken we will detect that during
  // verification and fall back to truncation.
  const PROMPT_VIA_STDIN_THRESHOLD = 100_000;

  // Main loop.
  while (true) {
    // Re-render AGENTS.md per turn — channel section depends on the current
    // chatJid (which may flip between IM channels for the same workspace).
    refreshAgentsMd();
    const result = await runCursorAgent({
      prompt,
      resumeChatId: currentChatId,
      containerInput,
      ipc,
      workspace: WORKSPACE_GROUP,
      promptViaStdin: prompt.length > PROMPT_VIA_STDIN_THRESHOLD,
    });

    if (result.sessionId) {
      currentChatId = result.sessionId;
      // Notify host so it can persist cursor_chat_id (Step 4 wiring).
      writeOutput({
        status: 'success',
        result: null,
        newSessionId: currentChatId,
        turnId: containerInput.turnId,
        sessionId: currentChatId,
      });
    }

    // Auto-compact bookkeeping: log this turn, check threshold, archive +
    // start a fresh chat when crossed. Skipped when threshold is disabled
    // or the turn was interrupted (no meaningful final to archive).
    if (compactThreshold > 0 && !result.interrupted && result.finalText) {
      pushTurn(compactState, {
        timestamp: new Date().toISOString(),
        user: prompt,
        assistant: result.finalText,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      if (shouldCompact(compactState, compactThreshold)) {
        const archivedAt = new Date().toISOString();
        const filename = defaultArchiveName(currentChatId, archivedAt);
        const md = buildArchiveMarkdown(compactState.log, {
          groupFolder: containerInput.groupFolder,
          chatId: currentChatId,
          archivedAt,
          threshold: compactThreshold,
        });
        const archivedTo = writeArchive(WORKSPACE_GROUP, filename, md);
        log(
          `Auto-compact triggered: ${compactState.cumulativeTokens} >= ${compactThreshold} tokens, ` +
          `archived ${compactState.log.length} turn(s) to ${archivedTo}`,
        );
        resetState(compactState);
        // Force a fresh Cursor chat on the next turn — cumulative context
        // would otherwise still be there server-side. The host gets notified
        // via the stream-event so it can mark the session boundary.
        const previousChatId = currentChatId;
        currentChatId = undefined;
        writeOutput({
          status: 'stream',
          result: null,
          turnId: containerInput.turnId,
          streamEvent: {
            eventType: 'status',
            turnId: containerInput.turnId,
            statusText: `auto_compact_archived (previous chat=${previousChatId ?? 'n/a'}, archive=${archivedTo})`,
          },
        });
      }
    }

    if (result.closedDuringRun) {
      log('Exiting due to _close consumed during cursor-agent run');
      writeOutput({ status: 'closed', result: null });
      break;
    }

    if (ipc.consumeDrain()) {
      log('_drain after run, exiting');
      writeOutput({ status: 'closed', result: null });
      break;
    }

    log('cursor-agent done, waiting for next IPC message…');
    const next = await ipc.waitForNext(log);
    if (next === null) {
      log('Close/drain received while idle, exiting');
      writeOutput({ status: 'success', result: null, newSessionId: currentChatId });
      break;
    }

    // Reset turn attribution for the new IPC message.
    const combined = combineMessages(next);
    containerInput.turnId = generateTurnId();
    currentTaskId = combined.taskId ?? null;
    if (combined.sourceJid) currentChatJid = combined.sourceJid;
    currentIsScheduled = false; // clear stale scheduled-task flag on user follow-up
    writeMcpContext({
      chatJid: currentChatJid,
      currentTaskId,
      isScheduledTask: currentIsScheduled,
    });

    prompt = combined.text;
    promptImages = combined.images.length > 0 ? combined.images : undefined;
    // Re-run attachment staging for the new turn — writes images to a
    // fresh per-turnId subdir and appends references to the new prompt.
    ensureAttachmentsForTurn();
  }
}

// Pipe-broken handlers (parent closed our stdout/stderr); silent exit.
(process.stdout as NodeJS.WriteStream).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
});
(process.stderr as NodeJS.WriteStream).on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
});

process.on('uncaughtException', (err) => {
  log(`Uncaught exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  try {
    writeOutput({
      status: 'error',
      result: null,
      error: err instanceof Error ? err.message : String(err),
    });
  } catch {
    /* stdout may be closed */
  }
  process.exit(1);
});

process.on('SIGTERM', () => {
  log('SIGTERM received, exiting gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('SIGINT received, exiting gracefully');
  process.exit(0);
});

main().catch((err) => {
  log(`Fatal in main(): ${err instanceof Error ? err.stack || err.message : String(err)}`);
  try {
    writeOutput({
      status: 'error',
      result: null,
      error: err instanceof Error ? err.message : String(err),
    });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
