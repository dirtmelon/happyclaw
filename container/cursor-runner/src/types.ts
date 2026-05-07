/**
 * Type declarations for cursor-runner.
 *
 * Two distinct surfaces:
 *   1. The host contract (`ContainerInput` / `ContainerOutput`) — must be
 *      byte-for-byte compatible with `container/agent-runner/src/types.ts` so
 *      the host process treats both runners interchangeably (Step 4 wires
 *      this).
 *   2. The Cursor stream-json schema — what `cursor-agent --print
 *      --output-format=stream-json --stream-partial-output` emits on stdout.
 *      Validated empirically (see plan attachment) against
 *      cursor-agent 2026.03.20 + claude-4.6-sonnet-medium.
 */

// ── happyclaw StreamEvent (canonical source: shared/stream-event.ts) ───────
export type {
  StreamEvent,
  StreamEventType,
} from './stream-event.types.js';

// ── Host contract (mirrors agent-runner) ───────────────────────────────────

export interface ContainerInput {
  prompt: string;
  sessionId?: string;
  turnId?: string;
  groupFolder: string;
  chatJid: string;
  currentSourceJid?: string;
  /** @deprecated Use isHome + isAdminHome instead. */
  isMain?: boolean;
  isHome?: boolean;
  isAdminHome?: boolean;
  isScheduledTask?: boolean;
  messageTaskId?: string;
  images?: Array<{ data: string; mimeType?: string }>;
  agentId?: string;
  agentName?: string;
}

import type { StreamEvent } from './stream-event.types.js';

export interface ContainerOutput {
  status: 'success' | 'error' | 'stream' | 'closed';
  result: string | null;
  newSessionId?: string;
  error?: string;
  streamEvent?: StreamEvent;
  turnId?: string;
  sessionId?: string;
  sdkMessageUuid?: string;
  sourceKind?:
    | 'sdk_final'
    | 'sdk_send_message'
    | 'interrupt_partial'
    | 'overflow_partial'
    | 'compact_partial'
    | 'legacy'
    | 'auto_continue';
  finalizationReason?: 'completed' | 'interrupted' | 'error';
}

// ── Cursor stream-json schema (subset we consume) ──────────────────────────

/**
 * `cursor-agent` emits one JSON object per line on stdout when invoked with
 * `--output-format=stream-json`. Order observed in real runs:
 *
 *   1. system/init       (once at start; carries session_id + model + cwd)
 *   2. user              (echo of the input prompt)
 *   3. tool_call started/completed (zero-or-more pairs, interleaved with assistant deltas)
 *   4. assistant         (zero-or-more, each with timestamp_ms = streaming chunk;
 *                         the FINAL one omits timestamp_ms and carries the full text)
 *   5. result            (once at end; carries usage + final result string)
 *
 * Other types may exist; they are ignored by our translator (no errors).
 */
export type CursorStreamMessage =
  | CursorSystemInit
  | CursorUserEcho
  | CursorAssistantDelta
  | CursorToolCallEvent
  | CursorResult
  | { type: string; [key: string]: unknown };

export interface CursorSystemInit {
  type: 'system';
  subtype: 'init';
  apiKeySource?: string;
  cwd: string;
  session_id: string;
  model: string;
  permissionMode?: string;
}

export interface CursorUserEcho {
  type: 'user';
  message: {
    role: 'user';
    content: Array<{ type: 'text'; text: string }>;
  };
  session_id: string;
}

export interface CursorAssistantDelta {
  type: 'assistant';
  message: {
    role: 'assistant';
    content: Array<{ type: 'text'; text: string }>;
  };
  session_id: string;
  /** Present on streaming chunks; absent on the final consolidated message. */
  timestamp_ms?: number;
}

/** Tool call wrapper. The actual tool args/result live in a dynamic key like
 * `readToolCall` / `shellToolCall` / `taskToolCall` / `globToolCall` /
 * `mcp__happyclaw__send_messageToolCall` etc. We use a generic record so we
 * don't have to enumerate all built-in Cursor tools. */
export interface CursorToolCallEvent {
  type: 'tool_call';
  subtype: 'started' | 'completed';
  call_id: string;
  /** Object with exactly one key, e.g. `{ readToolCall: { args, result? } }`.
   * The key suffix `ToolCall` is stripped to recover the tool name. */
  tool_call: Record<string, CursorToolCallBody>;
  model_call_id?: string;
  session_id: string;
  timestamp_ms?: number;
}

export interface CursorToolCallBody {
  args?: Record<string, unknown>;
  result?: {
    success?: Record<string, unknown>;
    error?: Record<string, unknown>;
  };
}

export interface CursorResult {
  type: 'result';
  subtype: 'success' | string;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  result?: string;
  session_id: string;
  request_id?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}
