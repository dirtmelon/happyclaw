/**
 * Translate `cursor-agent --output-format=stream-json` events into
 * happyclaw's `StreamEvent` shape so the Web UI consumes them indistinguishably
 * from agent-runner output. Pure logic — no IO or process management; the
 * caller wires emit callbacks (`emitStreamEvent` / `emitFinal` / `emitError`)
 * to the host-facing OUTPUT_MARKER protocol.
 *
 * Schema reference (validated against cursor-agent 2026.03.20):
 *   { "type": "system", "subtype": "init", ... }
 *   { "type": "user", ... }                       // echo, ignored
 *   { "type": "assistant", "message": { content: [{type:'text',text:...}] }, "timestamp_ms": N? }
 *   { "type": "tool_call", "subtype": "started"|"completed", "call_id":..., "tool_call": { "<name>ToolCall": { args, result? } } }
 *   { "type": "result", "subtype": "success"|"error_*", "usage": {...}, "result": "<final text>" }
 *
 * Empirically verified events:
 *   - `assistant` with `timestamp_ms` is a streaming delta (multiple per turn)
 *   - `assistant` WITHOUT `timestamp_ms` is the consolidated final message
 *     (always identical to the concatenation of preceding deltas).  We emit
 *     deltas as they arrive and ignore the final consolidated message to
 *     avoid duplicate text.
 *   - `tool_call.started/completed` carries the entire tool input as a single
 *     object (no `input_json_delta` streaming), so we synthesize start/end
 *     pairs without intermediate accumulation.
 */
import type {
  CursorAssistantDelta,
  CursorResult,
  CursorStreamMessage,
  CursorSystemInit,
  CursorToolCallEvent,
  StreamEvent,
} from './types.js';

export interface TranslatorContext {
  /** Caller-supplied turn ID (correlates all events for one user prompt). */
  turnId?: string;
  /** Discovered session_id from system/init — may be referenced by emitFinal. */
  sessionId?: string;
}

export interface TranslatorEmitters {
  /** Emit a single happyclaw StreamEvent to the host (wrap in OUTPUT_MARKER). */
  emitStreamEvent: (event: StreamEvent) => void;
  /** Emit the final result text + usage. Called once per turn from `processResult`. */
  emitFinal: (args: {
    text: string;
    sessionId: string;
    requestId?: string;
    usage?: NonNullable<CursorResult['usage']> & { durationMs?: number };
  }) => void;
  /** Emit an error result. */
  emitError: (args: { error: string; sessionId?: string }) => void;
  /** Diagnostic logger (stderr). */
  log: (msg: string) => void;
}

/** Strip the `ToolCall` suffix from the dynamic tool_call key. MCP tools keep
 * their `mcp__<server>__<name>` form unchanged; built-in Cursor tools (`read`,
 * `shell`, `task`, …) are PascalCased to align with Claude SDK conventions
 * already used by the StreamEventProcessor in agent-runner. */
function extractToolName(toolCallKey: string): string {
  const stripped = toolCallKey.replace(/ToolCall$/, '');
  if (stripped.startsWith('mcp__')) return stripped;
  if (stripped.length === 0) return stripped;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/** First non-empty line, capped to ~120 chars. Used for tool input summary. */
function summarizeArgs(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  try {
    const json = JSON.stringify(args);
    return json.length > 120 ? json.slice(0, 117) + '...' : json;
  } catch {
    return '';
  }
}

export class CursorStreamTranslator {
  private readonly ctx: TranslatorContext;
  private readonly emitters: TranslatorEmitters;
  /** Accumulated assistant text across all `text_delta` events for the current turn.
   * Used as fallback for emitFinal when result.result is empty. */
  private fullText = '';
  private sessionId: string | undefined;
  /** Tool calls we have already emitted `tool_use_start` for, so duplicate
   * `started` events (shouldn't happen but defensively guarded) don't double-emit. */
  private readonly seenStartedCallIds = new Set<string>();

  constructor(ctx: TranslatorContext, emitters: TranslatorEmitters) {
    this.ctx = ctx;
    this.emitters = emitters;
    this.sessionId = ctx.sessionId;
  }

  /** Process one parsed Cursor stream-json line. Returns true if this line was
   * a terminal `result` event (caller should stop reading after this). */
  process(msg: CursorStreamMessage): boolean {
    switch (msg.type) {
      case 'system':
        if ((msg as CursorSystemInit).subtype === 'init') {
          return this.processSystemInit(msg as CursorSystemInit);
        }
        return false;
      case 'user':
        // Echo of the input prompt — ignored. The host already has the prompt.
        return false;
      case 'assistant':
        return this.processAssistant(msg as CursorAssistantDelta);
      case 'tool_call':
        return this.processToolCall(msg as CursorToolCallEvent);
      case 'result':
        this.processResult(msg as CursorResult);
        return true;
      default:
        // Forward-compat: unknown type. Log and continue, don't crash.
        this.emitters.log(`Unknown stream-json type: ${msg.type}`);
        return false;
    }
  }

  /** Total accumulated text across the turn (used as final-result fallback). */
  getFullText(): string {
    return this.fullText;
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  // ── Per-message handlers ────────────────────────────────────────────────

  private processSystemInit(msg: CursorSystemInit): boolean {
    this.sessionId = msg.session_id;
    this.emitters.emitStreamEvent({
      eventType: 'init',
      turnId: this.ctx.turnId,
      sessionId: msg.session_id,
      statusText: `Cursor session initialized (model: ${msg.model})`,
    });
    return false;
  }

  private processAssistant(msg: CursorAssistantDelta): boolean {
    // Drop the consolidated final assistant message (no timestamp_ms) — its
    // content is always the concatenation of preceding deltas, so emitting
    // it would duplicate text on the wire.
    if (msg.timestamp_ms === undefined) return false;

    const blocks = Array.isArray(msg.message?.content)
      ? msg.message.content
      : [];
    let chunkText = '';
    for (const block of blocks) {
      if (block && block.type === 'text' && typeof block.text === 'string') {
        chunkText += block.text;
      }
    }
    if (chunkText.length === 0) return false;
    this.fullText += chunkText;
    this.emitters.emitStreamEvent({
      eventType: 'text_delta',
      turnId: this.ctx.turnId,
      sessionId: this.sessionId,
      text: chunkText,
    });
    return false;
  }

  private processToolCall(msg: CursorToolCallEvent): boolean {
    // Recover the tool name from the dynamic key. We expect exactly one key
    // in tool_call; if Cursor ever emits multiple we take the first.
    const keys = Object.keys(msg.tool_call ?? {});
    if (keys.length === 0) return false;
    const callKey = keys[0];
    const toolName = extractToolName(callKey);
    const body = msg.tool_call[callKey];

    if (msg.subtype === 'started') {
      if (this.seenStartedCallIds.has(msg.call_id)) return false;
      this.seenStartedCallIds.add(msg.call_id);
      this.emitters.emitStreamEvent({
        eventType: 'tool_use_start',
        turnId: this.ctx.turnId,
        sessionId: this.sessionId,
        toolUseId: msg.call_id,
        toolName,
        toolInputSummary: summarizeArgs(body?.args),
        toolInput: body?.args,
      });
    } else if (msg.subtype === 'completed') {
      const isError = !!body?.result?.error;
      this.emitters.emitStreamEvent({
        eventType: 'tool_use_end',
        turnId: this.ctx.turnId,
        sessionId: this.sessionId,
        toolUseId: msg.call_id,
        toolName,
        statusText: isError ? 'error' : 'success',
      });
    }
    return false;
  }

  private processResult(msg: CursorResult): void {
    const sid = msg.session_id || this.sessionId || '';
    if (!sid) {
      this.emitters.log(
        'Cursor result arrived without session_id — emitting empty session id',
      );
    }
    if (sid) this.sessionId = sid;

    if (msg.is_error || (typeof msg.subtype === 'string' && msg.subtype !== 'success')) {
      const errMessage =
        (msg.result && msg.result.trim()) ||
        `Cursor returned non-success subtype: ${msg.subtype || 'unknown'}`;
      this.emitters.emitError({ error: errMessage, sessionId: sid || undefined });
      return;
    }

    const text = (msg.result && msg.result.trim()) || this.fullText.trim();
    this.emitters.emitFinal({
      text,
      sessionId: sid,
      requestId: msg.request_id,
      usage: msg.usage
        ? { ...msg.usage, durationMs: msg.duration_ms }
        : undefined,
    });
  }
}

// ── Test helpers (exported for unit tests) ─────────────────────────────────

export const __test__ = {
  extractToolName,
  summarizeArgs,
};
