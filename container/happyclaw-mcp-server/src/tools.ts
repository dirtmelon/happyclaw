/**
 * HappyClaw built-in MCP tool definitions.
 *
 * These tool bodies are migrated from
 * `container/agent-runner/src/mcp-tools.ts` with one structural change:
 * each tool is now a plain `ToolDef` object instead of being wrapped by the
 * `tool()` helper of `@anthropic-ai/claude-agent-sdk`. The standalone stdio
 * server (`src/index.ts`) iterates `getActiveTools(staticCtx)` to register
 * with `@modelcontextprotocol/sdk`, validates incoming args with the zod
 * schema, then invokes the handler with a fresh `McpContext` rebuilt from
 * the mutable context file on every call.
 *
 * Tool semantics, IPC payloads, validation rules, and error messages are
 * identical to the in-process version so the host-side IPC consumer keeps
 * working unchanged.
 */
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { CronExpressionParser } from 'cron-parser';

import type { McpContext, StaticContext } from './context.js';
import { detectImageMimeTypeFromBase64Strict } from './image-detector.js';

// Re-export McpContext so external consumers (e.g. unit tests) can import
// the type from a single module alongside buildSendMessageData.
export type { McpContext } from './context.js';

/** Standard MCP-style tool result shape. */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface ToolDef<TArgs = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TArgs>;
  handler: (args: TArgs, ctx: McpContext) => Promise<ToolResult>;
}

// ── Shared helpers (verbatim from mcp-tools.ts) ────────────────────────────

function writeIpcFile(dir: string, data: object): string {
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const filepath = path.join(dir, filename);
  const tempPath = `${filepath}.tmp`;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
    fs.renameSync(tempPath, filepath);
  } catch (err) {
    try {
      fs.unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
    throw new Error(
      `IPC 写入失败 (${dir}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return filename;
}

async function pollIpcResult(
  dir: string,
  data: Record<string, unknown> & { requestId: string },
  resultFilePrefix: string,
  timeoutMs: number = 30_000,
): Promise<Record<string, unknown>> {
  const resultFileName = `${resultFilePrefix}_${data.requestId}.json`;
  const resultFilePath = path.join(dir, resultFileName);

  writeIpcFile(dir, data);

  const pollInterval = 500;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const raw = fs.readFileSync(resultFilePath, 'utf-8');
      fs.unlinkSync(resultFilePath);
      return JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }
  throw new Error(`Timeout waiting for IPC result (${timeoutMs / 1000}s)`);
}

function newRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Memory helpers ─────────────────────────────────────────────────────────

const MEMORY_EXTENSIONS = new Set(['.md', '.txt']);
const MEMORY_SUBDIRS = new Set(['memory', 'conversations']);
const MEMORY_SKIP_DIRS = new Set(['logs', '.claude', 'node_modules', '.git']);
const MAX_MEMORY_FILE_SIZE = 512 * 1024;
const MAX_MEMORY_APPEND_SIZE = 16 * 1024;
const MEMORY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function collectMemoryFiles(
  baseDir: string,
  out: string[],
  maxDepth: number,
  depth = 0,
): void {
  if (depth > maxDepth || !fs.existsSync(baseDir)) return;
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry.name);
      if (entry.isDirectory()) {
        if (MEMORY_SKIP_DIRS.has(entry.name)) continue;
        if (depth === 0 || MEMORY_SUBDIRS.has(entry.name)) {
          collectMemoryFiles(fullPath, out, maxDepth, depth + 1);
        }
      } else if (entry.isFile()) {
        if (
          entry.name === 'CLAUDE.md' ||
          MEMORY_EXTENSIONS.has(path.extname(entry.name))
        ) {
          out.push(fullPath);
        }
      }
    }
  } catch {
    /* skip unreadable */
  }
}

function createToRelativePath(ctx: McpContext) {
  return (filePath: string): string => {
    if (
      filePath === ctx.workspaceGlobal ||
      filePath.startsWith(ctx.workspaceGlobal + path.sep)
    ) {
      return `[global] ${path.relative(ctx.workspaceGlobal, filePath)}`;
    }
    if (
      filePath === ctx.workspaceMemory ||
      filePath.startsWith(ctx.workspaceMemory + path.sep)
    ) {
      return `[memory] ${path.relative(ctx.workspaceMemory, filePath)}`;
    }
    return path.relative(ctx.workspaceGroup, filePath);
  };
}

function parseMemoryFileReference(fileRef: string): {
  pathRef: string;
  lineFromRef?: number;
} {
  const trimmed = fileRef.trim();
  const lineRefMatch = trimmed.match(/^(.*?):(\d+)$/);
  if (!lineRefMatch) return { pathRef: trimmed };

  const lineFromRef = Number(lineRefMatch[2]);
  if (!Number.isInteger(lineFromRef) || lineFromRef <= 0) {
    return { pathRef: trimmed };
  }
  return { pathRef: lineRefMatch[1].trim(), lineFromRef };
}

/**
 * Build the IPC payload shared by send_message / send_image.
 * Pure function — exported for unit testing.
 *
 * Always stamps `chatJid`, `groupFolder`, `timestamp`. Conditionally stamps
 * `isScheduledTask` (when ctx.isScheduledTask is truthy) and `taskId` (when
 * ctx.currentTaskId is non-empty). The conditional stamping matters for
 * host-side routing: a missing `taskId` key means "regular user-turn reply",
 * while a present `taskId` key triggers the task-broadcast branch.
 */
export function buildSendMessageData(
  ctx: McpContext,
  extras: Record<string, unknown>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    chatJid: ctx.chatJid,
    groupFolder: ctx.groupFolder,
    timestamp: new Date().toISOString(),
    ...extras,
  };
  if (ctx.isScheduledTask) {
    data.isScheduledTask = true;
  }
  if (ctx.currentTaskId) {
    data.taskId = ctx.currentTaskId;
  }
  return data;
}

// ── Tool definitions ───────────────────────────────────────────────────────
// Order matches mcp-tools.ts so reviewers can diff side-by-side.

const sendMessageTool: ToolDef<{ text: string }> = {
  name: 'send_message',
  description:
    "Send a message to the user or group immediately while you're still running. Use this for progress updates or to send multiple messages. You can call this multiple times. Note: when running as a scheduled task, your final output is NOT sent to the user — use this tool if you need to communicate with the user or group.",
  inputSchema: z.object({
    text: z.string().describe('The message text to send'),
  }),
  async handler(args, ctx) {
    const messagesDir = path.join(ctx.workspaceIpc, 'messages');
    const data = buildSendMessageData(ctx, {
      type: 'message',
      text: args.text,
    });
    writeIpcFile(messagesDir, data);
    return { content: [{ type: 'text', text: 'Message sent.' }] };
  },
};

const sendImageTool: ToolDef<{ file_path: string; caption?: string }> = {
  name: 'send_image',
  description:
    'Send an image file from the workspace to the user via IM. Supports PNG/JPEG/GIF/WebP. Optional caption.',
  inputSchema: z.object({
    file_path: z
      .string()
      .describe(
        'Path to the image file in the workspace (relative to workspace root or absolute)',
      ),
    caption: z
      .string()
      .optional()
      .describe('Optional caption text to send with the image'),
  }),
  async handler(args, ctx) {
    const messagesDir = path.join(ctx.workspaceIpc, 'messages');
    const absPath = path.isAbsolute(args.file_path)
      ? args.file_path
      : path.join(ctx.workspaceGroup, args.file_path);
    const resolved = path.resolve(absPath);
    const safeRoot = ctx.workspaceGroup.endsWith(path.sep)
      ? ctx.workspaceGroup
      : ctx.workspaceGroup + path.sep;
    if (resolved !== ctx.workspaceGroup && !resolved.startsWith(safeRoot)) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: file path must be within workspace directory.`,
          },
        ],
        isError: true,
      };
    }
    if (!fs.existsSync(resolved)) {
      return {
        content: [
          { type: 'text', text: `Error: file not found: ${args.file_path}` },
        ],
        isError: true,
      };
    }
    const stat = fs.statSync(resolved);
    if (stat.size > 10 * 1024 * 1024) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: image file too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`,
          },
        ],
        isError: true,
      };
    }
    if (stat.size === 0) {
      return {
        content: [{ type: 'text', text: `Error: image file is empty.` }],
        isError: true,
      };
    }
    const buffer = fs.readFileSync(resolved);
    const base64 = buffer.toString('base64');
    const mimeType = detectImageMimeTypeFromBase64Strict(base64);
    if (!mimeType) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: file does not appear to be a supported image format (PNG, JPEG, GIF, WebP, TIFF, BMP).`,
          },
        ],
        isError: true,
      };
    }
    const data = buildSendMessageData(ctx, {
      type: 'image',
      imageBase64: base64,
      mimeType,
      caption: args.caption || undefined,
      fileName: path.basename(resolved),
    });
    writeIpcFile(messagesDir, data);
    return {
      content: [
        {
          type: 'text',
          text: `Image sent: ${path.basename(resolved)} (${mimeType}, ${(stat.size / 1024).toFixed(1)}KB)`,
        },
      ],
    };
  },
};

const sendFileTool: ToolDef<{ filePath: string; fileName: string }> = {
  name: 'send_file',
  description: `Send a file to the current chat (the user you're talking to) via IM (Feishu/Telegram/DingTalk/QQ/Discord). The file path is relative to the workspace/group directory.
Supports: PDF, DOC, XLS, PPT, MP4, ZIP, SO, etc. Max file size: 30MB.`,
  inputSchema: z.object({
    filePath: z
      .string()
      .describe(
        'File path relative to workspace/group (e.g., "output/report.pdf")',
      ),
    fileName: z
      .string()
      .describe('File name to display (e.g., "report.pdf")'),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    let resolvedPath: string;
    let relativePath: string;
    if (path.isAbsolute(args.filePath)) {
      resolvedPath = path.resolve(args.filePath);
      const safeRoot = ctx.workspaceGroup.endsWith(path.sep)
        ? ctx.workspaceGroup
        : ctx.workspaceGroup + path.sep;
      if (
        resolvedPath !== ctx.workspaceGroup &&
        !resolvedPath.startsWith(safeRoot)
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: file must be within the workspace/group directory.',
            },
          ],
          isError: true,
        };
      }
      relativePath = path.relative(ctx.workspaceGroup, resolvedPath);
    } else {
      relativePath = args.filePath;
      resolvedPath = path.resolve(ctx.workspaceGroup, args.filePath);
      const safeRoot = ctx.workspaceGroup.endsWith(path.sep)
        ? ctx.workspaceGroup
        : ctx.workspaceGroup + path.sep;
      if (
        resolvedPath !== ctx.workspaceGroup &&
        !resolvedPath.startsWith(safeRoot)
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: file must be within the workspace/group directory.',
            },
          ],
          isError: true,
        };
      }
    }
    if (!fs.existsSync(resolvedPath)) {
      return {
        content: [
          { type: 'text', text: `Error: file not found: ${args.filePath}` },
        ],
        isError: true,
      };
    }
    const data = {
      type: 'send_file',
      chatJid: ctx.chatJid,
      filePath: relativePath,
      fileName: args.fileName,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(tasksDir, data);
    return {
      content: [
        { type: 'text', text: `Sending file "${args.fileName}"...` },
      ],
    };
  },
};

interface ScheduleTaskArgs {
  prompt?: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  execution_type?: 'agent' | 'script';
  script_command?: string;
  execution_mode?: 'host' | 'container';
  context_mode?: 'group' | 'isolated';
  target_group_jid?: string;
}

const scheduleTaskTool: ToolDef<ScheduleTaskArgs> = {
  name: 'schedule_task',
  description: `Schedule a recurring or one-time task.

EXECUTION TYPE:
• "agent" (default): Task runs as a full Claude Agent with access to all tools. Consumes API tokens.
• "script" (admin only): Task runs a shell command directly on the host. Zero API token cost. Use for deterministic tasks like health checks, data collection, cURL calls, or cron-like scripts.

EXECUTION MODE:
• "host": Task runs directly on the host machine. Admin only.
• "container" (default for non-admin): Task runs in a Docker container.
Each agent task automatically gets its own dedicated workspace.

CONTEXT MODE (agent mode only) - Choose based on task type:
• "group": Task runs in the group's conversation context, with access to chat history.
• "isolated": Task runs in a fresh session with no conversation history.

MESSAGING BEHAVIOR - The task output is sent to the user or group.
• Agent mode: output is sent via MCP tool or stdout. Use <internal> tags to suppress.
• Script mode: stdout is sent as the result. stderr is included on failure.

SCHEDULE VALUE FORMAT (all times are LOCAL timezone):
• cron: Standard cron expression (e.g., "*/5 * * * *" for every 5 minutes, "0 9 * * *" for daily at 9am LOCAL time)
• interval: Milliseconds between runs (e.g., "300000" for 5 minutes, "3600000" for 1 hour)
• once: Local time WITHOUT "Z" suffix (e.g., "2026-02-01T15:30:00"). Do NOT use UTC/Z suffix.`,
  inputSchema: z.object({
    prompt: z
      .string()
      .optional()
      .default('')
      .describe(
        'What the agent should do (agent mode) or task description (script mode, optional).',
      ),
    schedule_type: z
      .enum(['cron', 'interval', 'once'])
      .describe(
        'cron=recurring at specific times, interval=recurring every N ms, once=run once at specific time',
      ),
    schedule_value: z
      .string()
      .describe(
        'cron: "*/5 * * * *" | interval: milliseconds like "300000" | once: local timestamp like "2026-02-01T15:30:00" (no Z suffix!)',
      ),
    execution_type: z
      .enum(['agent', 'script'])
      .default('agent')
      .describe(
        'agent=full Claude Agent (default), script=shell command (admin only, zero token cost)',
      ),
    script_command: z
      .string()
      .max(4096)
      .optional()
      .describe(
        'Shell command to execute (required for script mode). Runs in the group workspace directory.',
      ),
    execution_mode: z
      .enum(['host', 'container'])
      .optional()
      .describe(
        'Execution mode: host runs directly on the server, container runs in Docker isolation',
      ),
    context_mode: z
      .enum(['group', 'isolated'])
      .default('group')
      .describe(
        '(agent mode only) group=runs with persistent workspace context (recommended), isolated=fresh session each time',
      ),
    target_group_jid: z
      .string()
      .optional()
      .describe(
        '(Admin home only) JID of the group to schedule the task for. Defaults to the current group.',
      ),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    const hasCrossGroupAccess = ctx.isAdminHome;
    const execType = args.execution_type || 'agent';

    if (execType === 'agent' && !args.prompt?.trim()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Agent mode requires a prompt. Provide instructions for what the agent should do.',
          },
        ],
        isError: true,
      };
    }
    if (execType === 'script' && !args.script_command?.trim()) {
      return {
        content: [
          {
            type: 'text',
            text: 'Script mode requires script_command. Provide the shell command to execute.',
          },
        ],
        isError: true,
      };
    }
    if (execType === 'script' && !ctx.isAdminHome) {
      return {
        content: [
          {
            type: 'text',
            text: 'Only admin home container can create script tasks.',
          },
        ],
        isError: true,
      };
    }

    if (args.schedule_type === 'cron') {
      try {
        CronExpressionParser.parse(args.schedule_value, {
          tz: process.env.TZ || 'Asia/Shanghai',
        });
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid cron: "${args.schedule_value}". Use format like "0 9 * * *" (daily 9am) or "*/5 * * * *" (every 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'interval') {
      const ms = parseInt(args.schedule_value, 10);
      if (isNaN(ms) || ms <= 0) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid interval: "${args.schedule_value}". Must be positive milliseconds (e.g., "300000" for 5 min).`,
            },
          ],
          isError: true,
        };
      }
    } else if (args.schedule_type === 'once') {
      const date = new Date(args.schedule_value);
      if (isNaN(date.getTime())) {
        return {
          content: [
            {
              type: 'text',
              text: `Invalid timestamp: "${args.schedule_value}". Use ISO 8601 format like "2026-02-01T15:30:00.000Z".`,
            },
          ],
          isError: true,
        };
      }
    }

    const targetJid =
      hasCrossGroupAccess && args.target_group_jid
        ? args.target_group_jid
        : ctx.chatJid;
    const data: Record<string, unknown> = {
      type: 'schedule_task',
      prompt: args.prompt || '',
      schedule_type: args.schedule_type,
      schedule_value: args.schedule_value,
      context_mode: args.context_mode || 'isolated',
      execution_type: execType,
      targetJid,
      createdBy: ctx.groupFolder,
      timestamp: new Date().toISOString(),
    };
    if (execType === 'script') {
      data.script_command = args.script_command;
    }
    if (args.execution_mode) {
      data.execution_mode = args.execution_mode;
    }
    const filename = writeIpcFile(tasksDir, data);
    const modeLabel = execType === 'script' ? 'script' : 'agent';
    return {
      content: [
        {
          type: 'text',
          text: `Task scheduled [${modeLabel}] (${filename}): ${args.schedule_type} - ${args.schedule_value}`,
        },
      ],
    };
  },
};

const listTasksTool: ToolDef<Record<string, never>> = {
  name: 'list_tasks',
  description:
    "List all scheduled tasks. From admin home: shows all tasks. From other groups: shows only that group's tasks.",
  inputSchema: z.object({}),
  async handler(_args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    const hasCrossGroupAccess = ctx.isAdminHome;
    const requestId = newRequestId();
    try {
      const result = await pollIpcResult(
        tasksDir,
        {
          type: 'list_tasks',
          requestId,
          groupFolder: ctx.groupFolder,
          isAdminHome: hasCrossGroupAccess,
          timestamp: new Date().toISOString(),
        },
        'list_tasks_result',
      );
      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Error listing tasks: ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
      const tasks = (result.tasks || []) as Array<{
        id: string;
        prompt: string;
        schedule_type: string;
        schedule_value: string;
        status: string;
        next_run: string;
      }>;
      if (tasks.length === 0) {
        return {
          content: [{ type: 'text', text: 'No scheduled tasks found.' }],
        };
      }
      const formatted = tasks
        .map(
          (t) =>
            `- [${t.id}] ${t.prompt.slice(0, 50)}... (${t.schedule_type}: ${t.schedule_value}) - ${t.status}, next: ${t.next_run || 'N/A'}`,
        )
        .join('\n');
      return {
        content: [{ type: 'text', text: `Scheduled tasks:\n${formatted}` }],
      };
    } catch {
      return {
        content: [
          { type: 'text', text: 'Timeout waiting for task list response.' },
        ],
        isError: true,
      };
    }
  },
};

const pauseTaskTool: ToolDef<{ task_id: string }> = {
  name: 'pause_task',
  description: 'Pause a scheduled task. It will not run until resumed.',
  inputSchema: z.object({
    task_id: z.string().describe('The task ID to pause'),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    const hasCrossGroupAccess = ctx.isAdminHome;
    const data = {
      type: 'pause_task',
      taskId: args.task_id,
      groupFolder: ctx.groupFolder,
      isMain: hasCrossGroupAccess,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(tasksDir, data);
    return {
      content: [
        { type: 'text', text: `Task ${args.task_id} pause requested.` },
      ],
    };
  },
};

const resumeTaskTool: ToolDef<{ task_id: string }> = {
  name: 'resume_task',
  description: 'Resume a paused task.',
  inputSchema: z.object({
    task_id: z.string().describe('The task ID to resume'),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    const hasCrossGroupAccess = ctx.isAdminHome;
    const data = {
      type: 'resume_task',
      taskId: args.task_id,
      groupFolder: ctx.groupFolder,
      isMain: hasCrossGroupAccess,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(tasksDir, data);
    return {
      content: [
        { type: 'text', text: `Task ${args.task_id} resume requested.` },
      ],
    };
  },
};

const cancelTaskTool: ToolDef<{ task_id: string }> = {
  name: 'cancel_task',
  description: 'Cancel and delete a scheduled task.',
  inputSchema: z.object({
    task_id: z.string().describe('The task ID to cancel'),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    const hasCrossGroupAccess = ctx.isAdminHome;
    const data = {
      type: 'cancel_task',
      taskId: args.task_id,
      groupFolder: ctx.groupFolder,
      isMain: hasCrossGroupAccess,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(tasksDir, data);
    return {
      content: [
        {
          type: 'text',
          text: `Task ${args.task_id} cancellation requested.`,
        },
      ],
    };
  },
};

interface RegisterGroupArgs {
  jid: string;
  name: string;
  folder: string;
  execution_mode?: 'container' | 'host';
}

const registerGroupTool: ToolDef<RegisterGroupArgs> = {
  name: 'register_group',
  description: `Register a new group so the agent can respond to messages there. Admin home only.

Use available_groups.json to find the JID for a group. The folder name should be lowercase with hyphens (e.g., "family-chat").
You can optionally specify execution_mode: "container" (default, isolated Docker) or "host" (direct host access, admin only).`,
  inputSchema: z.object({
    jid: z.string().describe('The chat JID (e.g., "feishu:oc_xxxx")'),
    name: z.string().describe('Display name for the group'),
    folder: z
      .string()
      .describe(
        'Folder name for group files (lowercase, hyphens, e.g., "family-chat")',
      ),
    execution_mode: z
      .enum(['container', 'host'])
      .optional()
      .describe(
        'Execution mode: "container" (default, isolated Docker) or "host" (direct host access)',
      ),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    if (!ctx.isAdminHome) {
      return {
        content: [
          {
            type: 'text',
            text: 'Only the admin home container can register new groups.',
          },
        ],
        isError: true,
      };
    }
    const data = {
      type: 'register_group',
      jid: args.jid,
      name: args.name,
      folder: args.folder,
      executionMode: args.execution_mode,
      timestamp: new Date().toISOString(),
    };
    writeIpcFile(tasksDir, data);
    return {
      content: [
        {
          type: 'text',
          text: `Group "${args.name}" registered. It will start receiving messages immediately.`,
        },
      ],
    };
  },
};

const discordSnowflakeRegex = /^\d{17,20}$/;

const discordGetHistoryTool: ToolDef<{ limit?: number; before?: string }> = {
  name: 'discord_get_history',
  description: `Fetch recent messages from the current Discord channel or DM. Only works when the current chat is a Discord channel.
Returns up to 100 messages per call (default 50), ordered oldest-first. Use "before" with a message ID to paginate older messages.`,
  inputSchema: z.object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe('Number of messages to fetch (1-100, default 50)'),
    before: z
      .string()
      .regex(discordSnowflakeRegex, 'must be a Discord snowflake')
      .optional()
      .describe(
        'Message ID (snowflake) — only return messages older than this. Use the "id" of the oldest message in your previous batch to paginate.',
      ),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    if (!ctx.chatJid.startsWith('discord:')) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: discord_get_history only works in Discord channels. Current chat: ${ctx.chatJid}`,
          },
        ],
        isError: true,
      };
    }
    const requestId = newRequestId();
    try {
      const result = await pollIpcResult(
        tasksDir,
        {
          type: 'discord_get_history',
          chatJid: ctx.chatJid,
          limit: args.limit,
          before: args.before,
          requestId,
          timestamp: new Date().toISOString(),
        },
        'discord_get_history_result',
      );
      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching Discord history: ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
      const messages = (result.messages || []) as Array<{
        id: string;
        authorName: string;
        authorBot: boolean;
        content: string;
        timestamp: string;
        attachments: Array<{ name: string; url: string }>;
        replyToId?: string;
        edited: boolean;
      }>;
      if (messages.length === 0) {
        return {
          content: [
            { type: 'text', text: 'No messages found in this channel.' },
          ],
        };
      }
      const formatted = messages
        .map((m) => {
          const tag = m.authorBot ? ' [bot]' : '';
          const editFlag = m.edited ? ' (edited)' : '';
          const replyFlag = m.replyToId ? ` ↪${m.replyToId}` : '';
          const attachStr =
            m.attachments.length > 0
              ? `\n  📎 ${m.attachments.map((a) => a.name).join(', ')}`
              : '';
          return `[${m.timestamp}] ${m.authorName}${tag}${replyFlag}${editFlag} (id=${m.id})\n  ${m.content || '(empty)'}${attachStr}`;
        })
        .join('\n\n');
      return {
        content: [
          {
            type: 'text',
            text: `Discord history (${messages.length} messages, oldest first):\n\n${formatted}`,
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'Timeout waiting for Discord history response.',
          },
        ],
        isError: true,
      };
    }
  },
};

const discordGetChannelInfoTool: ToolDef<Record<string, never>> = {
  name: 'discord_get_channel_info',
  description: `Get metadata for the current Discord channel: name, type (guild_text/dm/etc), topic, NSFW flag, parent (category) ID, and guild ID.
Only works when the current chat is a Discord channel.`,
  inputSchema: z.object({}),
  async handler(_args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    if (!ctx.chatJid.startsWith('discord:')) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: discord_get_channel_info only works in Discord channels. Current chat: ${ctx.chatJid}`,
          },
        ],
        isError: true,
      };
    }
    const requestId = newRequestId();
    try {
      const result = await pollIpcResult(
        tasksDir,
        {
          type: 'discord_get_channel_info',
          chatJid: ctx.chatJid,
          requestId,
          timestamp: new Date().toISOString(),
        },
        'discord_get_channel_info_result',
      );
      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching Discord channel info: ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Discord channel info:\n${JSON.stringify(result.channel, null, 2)}`,
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'Timeout waiting for Discord channel info response.',
          },
        ],
        isError: true,
      };
    }
  },
};

const discordGetServerInfoTool: ToolDef<Record<string, never>> = {
  name: 'discord_get_server_info',
  description: `Get metadata for the Discord server (guild) the current channel belongs to: name, description, owner ID, member count, icon URL.
Returns null if the current chat is a DM (DMs do not belong to a server). Only works when the current chat is a Discord channel.`,
  inputSchema: z.object({}),
  async handler(_args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    if (!ctx.chatJid.startsWith('discord:')) {
      return {
        content: [
          {
            type: 'text',
            text: `Error: discord_get_server_info only works in Discord channels. Current chat: ${ctx.chatJid}`,
          },
        ],
        isError: true,
      };
    }
    const requestId = newRequestId();
    try {
      const result = await pollIpcResult(
        tasksDir,
        {
          type: 'discord_get_server_info',
          chatJid: ctx.chatJid,
          requestId,
          timestamp: new Date().toISOString(),
        },
        'discord_get_server_info_result',
      );
      if (!result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Error fetching Discord server info: ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
      if (result.guild === null) {
        return {
          content: [
            {
              type: 'text',
              text: 'This is a DM channel — no server (guild) information available.',
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: `Discord server info:\n${JSON.stringify(result.guild, null, 2)}`,
          },
        ],
      };
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'Timeout waiting for Discord server info response.',
          },
        ],
        isError: true,
      };
    }
  },
};

// ── Skills tools (only when isHome) ────────────────────────────────────────

const installSkillTool: ToolDef<{ package: string }> = {
  name: 'install_skill',
  description: `Install a skill from the skills registry (skills.sh). The skill will be available in future conversations.
Example packages: "anthropic/memory", "anthropic/think", "owner/repo", "owner/repo@skill-name".`,
  inputSchema: z.object({
    package: z
      .string()
      .describe(
        'The skill package to install, format: owner/repo or owner/repo@skill',
      ),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    const pkg = args.package.trim();
    if (
      !/^[\w\-]+\/[\w\-.]+(?:[@#][\w\-.\/]+)?$/.test(pkg) &&
      !/^https?:\/\//.test(pkg)
    ) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid package format: "${pkg}". Expected format: owner/repo or owner/repo@skill`,
          },
        ],
        isError: true,
      };
    }

    const requestId = newRequestId();
    try {
      const result = await pollIpcResult(
        tasksDir,
        {
          type: 'install_skill',
          package: pkg,
          requestId,
          groupFolder: ctx.groupFolder,
          timestamp: new Date().toISOString(),
        },
        'install_skill_result',
        120_000,
      );
      if (result.success) {
        const installed =
          ((result.installed as string[]) || []).join(', ') || pkg;
        return {
          content: [
            {
              type: 'text',
              text: `Skill installed successfully: ${installed}\n\nNote: The skill will be available in the next conversation (new container/process).`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to install skill "${pkg}": ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: `Timeout waiting for skill installation result (120s). The installation may still be in progress.`,
          },
        ],
        isError: true,
      };
    }
  },
};

const uninstallSkillTool: ToolDef<{ skill_id: string }> = {
  name: 'uninstall_skill',
  description: `Uninstall a user-level skill by its ID. Project-level skills cannot be uninstalled.
Use the skills panel in the UI to find the skill ID (directory name, e.g. "memory", "think").`,
  inputSchema: z.object({
    skill_id: z
      .string()
      .describe(
        'The skill ID to uninstall (the directory name, e.g. "memory", "think")',
      ),
  }),
  async handler(args, ctx) {
    const tasksDir = path.join(ctx.workspaceIpc, 'tasks');
    const skillId = args.skill_id.trim();
    if (!skillId || !/^[\w\-]+$/.test(skillId)) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid skill ID: "${skillId}". Must be alphanumeric with hyphens/underscores.`,
          },
        ],
        isError: true,
      };
    }

    const requestId = newRequestId();
    try {
      const result = await pollIpcResult(
        tasksDir,
        {
          type: 'uninstall_skill',
          skillId,
          requestId,
          groupFolder: ctx.groupFolder,
          timestamp: new Date().toISOString(),
        },
        'uninstall_skill_result',
      );
      if (result.success) {
        return {
          content: [
            {
              type: 'text',
              text: `Skill "${skillId}" uninstalled successfully.`,
            },
          ],
        };
      } else {
        return {
          content: [
            {
              type: 'text',
              text: `Failed to uninstall skill "${skillId}": ${result.error || 'Unknown error'}`,
            },
          ],
          isError: true,
        };
      }
    } catch {
      return {
        content: [
          {
            type: 'text',
            text: 'Timeout waiting for uninstall response.',
          },
        ],
        isError: true,
      };
    }
  },
};

// ── Memory tools (only when !disableMemoryLayer) ───────────────────────────

const memoryAppendTool: ToolDef<{ content: string; date?: string }> = {
  name: 'memory_append',
  description: `\u5c06**\u65f6\u6548\u6027\u8bb0\u5fc6**\u8ffd\u52a0\u5230 memory/YYYY-MM-DD.md\uff08\u72ec\u7acb\u8bb0\u5fc6\u76ee\u5f55\uff0c\u4e0d\u5728\u5de5\u4f5c\u533a\u5185\uff09\u3002
\u4ec5\u8ffd\u52a0\u5199\u5165\uff0c\u4e0d\u4f1a\u8986\u76d6\u5df2\u6709\u5185\u5bb9\u3002

\u4ec5\u7528\u4e8e\u660e\u786e\u53ea\u8ddf\u5f53\u5929/\u77ed\u671f\u6709\u5173\u7684\u4fe1\u606f\uff1a\u4eca\u65e5\u9879\u76ee\u8fdb\u5c55\u3001\u4e34\u65f6\u6280\u672f\u51b3\u7b56\u3001\u5f85\u529e\u4e8b\u9879\u3001\u4f1a\u8bae\u8981\u70b9\u7b49\u3002

**\u91cd\u8981**\uff1a\u4e0b\u6b21\u5bf9\u8bdd\u4ecd\u53ef\u80fd\u7528\u5230\u7684\u4fe1\u606f\uff08\u7528\u6237\u8eab\u4efd\u3001\u504f\u597d\u3001\u5e38\u7528\u9879\u76ee\u3001\u7528\u6237\u8bf4\u201c\u8bb0\u4f4f\u201d\u7684\u5185\u5bb9\uff09\u5e94\u76f4\u63a5\u7528 Edit \u5de5\u5177\u7f16\u8f91 /workspace/global/CLAUDE.md\uff0c\u4e0d\u8981\u7528\u6b64\u5de5\u5177\u3002`,
  inputSchema: z.object({
    content: z.string().describe('要追加的记忆内容'),
    date: z
      .string()
      .optional()
      .describe('目标日期，格式 YYYY-MM-DD（默认：今天）'),
  }),
  async handler(args, ctx) {
    const normalizedContent = args.content.replace(/\r\n?/g, '\n').trim();
    if (!normalizedContent) {
      return {
        content: [{ type: 'text', text: '内容不能为空。' }],
        isError: true,
      };
    }
    const appendBytes = Buffer.byteLength(normalizedContent, 'utf-8');
    if (appendBytes > MAX_MEMORY_APPEND_SIZE) {
      return {
        content: [
          {
            type: 'text',
            text: `内容过大：${appendBytes} 字节（上限 ${MAX_MEMORY_APPEND_SIZE}）。`,
          },
        ],
        isError: true,
      };
    }
    const date = (
      args.date ?? new Date().toISOString().split('T')[0]
    ).trim();
    if (!MEMORY_DATE_PATTERN.test(date)) {
      return {
        content: [
          {
            type: 'text',
            text: `日期格式无效："${date}"，请使用 YYYY-MM-DD。`,
          },
        ],
        isError: true,
      };
    }
    const resolvedPath = path.normalize(
      path.join(ctx.workspaceMemory, `${date}.md`),
    );
    const inMemory =
      resolvedPath === ctx.workspaceMemory ||
      resolvedPath.startsWith(ctx.workspaceMemory + path.sep);
    if (!inMemory) {
      return {
        content: [
          { type: 'text', text: '访问被拒绝：路径超出工作区范围。' },
        ],
        isError: true,
      };
    }
    try {
      fs.mkdirSync(ctx.workspaceMemory, { recursive: true });
      const fileExists = fs.existsSync(resolvedPath);
      const currentSize = fileExists ? fs.statSync(resolvedPath).size : 0;
      const separator = currentSize > 0 ? '\n---\n\n' : '';
      const entry = `${separator}### ${new Date().toISOString()}\n${normalizedContent}\n`;
      const nextSize = currentSize + Buffer.byteLength(entry, 'utf-8');
      if (nextSize > MAX_MEMORY_FILE_SIZE) {
        return {
          content: [
            {
              type: 'text',
              text: `记忆文件将超过 ${MAX_MEMORY_FILE_SIZE} 字节上限，请缩短内容。`,
            },
          ],
          isError: true,
        };
      }
      fs.appendFileSync(resolvedPath, entry, 'utf-8');
      return {
        content: [
          {
            type: 'text',
            text: `已追加到 memory/${date}.md（${appendBytes} 字节）。`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `追加记忆时出错：${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
};

const memorySearchTool: ToolDef<{ query: string; max_results?: number }> = {
  name: 'memory_search',
  description: `在工作区的记忆文件中搜索（CLAUDE.md、memory/、conversations/ 及其他 .md/.txt 文件）。
返回文件路径、行号和上下文片段。超过 512KB 的文件会被跳过。
用于回忆过去的决策、偏好、项目上下文或对话历史。`,
  inputSchema: z.object({
    query: z.string().describe('搜索关键词或短语（不区分大小写）'),
    max_results: z
      .number()
      .optional()
      .default(20)
      .describe('最大结果数（默认 20，上限 50）'),
  }),
  async handler(args, ctx) {
    const toRelativePath = createToRelativePath(ctx);
    if (!args.query.trim()) {
      return {
        content: [{ type: 'text', text: '搜索关键词不能为空。' }],
        isError: true,
      };
    }
    const maxResults = Math.min(Math.max(args.max_results ?? 20, 1), 50);
    const queryLower = args.query.toLowerCase();
    const files: string[] = [];
    collectMemoryFiles(ctx.workspaceMemory, files, 4);
    collectMemoryFiles(ctx.workspaceGroup, files, 4);
    collectMemoryFiles(ctx.workspaceGlobal, files, 4);
    const uniqueFiles = Array.from(new Set(files));
    if (uniqueFiles.length === 0) {
      return {
        content: [{ type: 'text', text: '未找到记忆文件。' }],
      };
    }
    const results: string[] = [];
    let skippedLarge = 0;
    for (const filePath of uniqueFiles) {
      if (results.length >= maxResults) break;
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > MAX_MEMORY_FILE_SIZE) {
          skippedLarge++;
          continue;
        }
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        let lastEnd = -1;
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;
          if (lines[i].toLowerCase().includes(queryLower)) {
            const start = Math.max(0, i - 1);
            if (start <= lastEnd) continue;
            const end = Math.min(lines.length, i + 2);
            lastEnd = end;
            const snippet = lines.slice(start, end).join('\n');
            results.push(`${toRelativePath(filePath)}:${i + 1}\n${snippet}`);
          }
        }
      } catch {
        /* skip unreadable */
      }
    }
    const skippedNote =
      skippedLarge > 0 ? `（跳过 ${skippedLarge} 个大文件）` : '';
    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: `在 ${uniqueFiles.length} 个记忆文件中未找到“${args.query}”的匹配。${skippedNote}`,
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `找到 ${results.length} 条匹配${skippedNote}：\n\n${results.join('\n---\n')}`,
        },
      ],
    };
  },
};

const memoryGetTool: ToolDef<{ file: string; from_line?: number; lines?: number }> = {
  name: 'memory_get',
  description: `读取记忆文件或指定行范围。在 memory_search 之后使用以获取完整上下文。`,
  inputSchema: z.object({
    file: z
      .string()
      .describe(
        '相对路径，可带 :行号（如 "CLAUDE.md:12"、"[global] CLAUDE.md:8" 或 "[memory] 2026-01-15.md"）',
      ),
    from_line: z
      .number()
      .optional()
      .describe('起始行号（从 1 开始，默认：1）'),
    lines: z
      .number()
      .optional()
      .describe('读取行数（默认：全部，上限：200）'),
  }),
  async handler(args, ctx) {
    const { pathRef, lineFromRef } = parseMemoryFileReference(args.file);
    let resolvedPath: string;
    if (pathRef.startsWith('[global] ')) {
      resolvedPath = path.join(
        ctx.workspaceGlobal,
        pathRef.slice('[global] '.length),
      );
    } else if (pathRef.startsWith('[memory] ')) {
      resolvedPath = path.join(
        ctx.workspaceMemory,
        pathRef.slice('[memory] '.length),
      );
    } else {
      resolvedPath = path.join(ctx.workspaceGroup, pathRef);
    }
    resolvedPath = path.normalize(resolvedPath);
    const inGroup =
      resolvedPath === ctx.workspaceGroup ||
      resolvedPath.startsWith(ctx.workspaceGroup + path.sep);
    const inGlobal =
      resolvedPath === ctx.workspaceGlobal ||
      resolvedPath.startsWith(ctx.workspaceGlobal + path.sep);
    const inMemory =
      resolvedPath === ctx.workspaceMemory ||
      resolvedPath.startsWith(ctx.workspaceMemory + path.sep);
    if (!inGroup && !inGlobal && !inMemory) {
      return {
        content: [
          { type: 'text', text: '访问被拒绝：路径超出工作区范围。' },
        ],
        isError: true,
      };
    }
    if (!fs.existsSync(resolvedPath)) {
      return {
        content: [
          { type: 'text', text: `文件未找到：${pathRef}` },
        ],
        isError: true,
      };
    }
    try {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      const allLines = content.split('\n');
      const fromLine = Math.max(
        (args.from_line ?? lineFromRef ?? 1) - 1,
        0,
      );
      const maxLines = Math.min(args.lines ?? allLines.length, 200);
      const slice = allLines.slice(fromLine, fromLine + maxLines);
      const header = `${pathRef}（第 ${fromLine + 1}-${fromLine + slice.length} 行，共 ${allLines.length} 行）`;
      return {
        content: [
          { type: 'text', text: `${header}\n\n${slice.join('\n')}` },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text',
            text: `读取文件时出错：${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  },
};

// ── Active tool selection ──────────────────────────────────────────────────

const ALWAYS_ON_TOOLS: ToolDef<unknown>[] = [
  sendMessageTool as ToolDef<unknown>,
  sendImageTool as ToolDef<unknown>,
  sendFileTool as ToolDef<unknown>,
  scheduleTaskTool as ToolDef<unknown>,
  listTasksTool as ToolDef<unknown>,
  pauseTaskTool as ToolDef<unknown>,
  resumeTaskTool as ToolDef<unknown>,
  cancelTaskTool as ToolDef<unknown>,
  registerGroupTool as ToolDef<unknown>,
  discordGetHistoryTool as ToolDef<unknown>,
  discordGetChannelInfoTool as ToolDef<unknown>,
  discordGetServerInfoTool as ToolDef<unknown>,
];

/**
 * Select tools registered for a given static context. Mirrors the conditional
 * registration in the legacy mcp-tools.ts (install/uninstall/memory_append
 * are home-only; memory_search/get + memory_append are gated by
 * disableMemoryLayer).
 */
export function getActiveTools(staticCtx: StaticContext): ToolDef<unknown>[] {
  const tools: ToolDef<unknown>[] = [...ALWAYS_ON_TOOLS];
  if (staticCtx.isHome) {
    tools.push(installSkillTool as ToolDef<unknown>);
    tools.push(uninstallSkillTool as ToolDef<unknown>);
  }
  if (staticCtx.isHome && !staticCtx.disableMemoryLayer) {
    tools.push(memoryAppendTool as ToolDef<unknown>);
  }
  if (!staticCtx.disableMemoryLayer) {
    tools.push(memorySearchTool as ToolDef<unknown>);
    tools.push(memoryGetTool as ToolDef<unknown>);
  }
  return tools;
}

/** Exported for unit tests. */
export const ALL_TOOLS_FOR_TESTING = {
  sendMessageTool,
  sendImageTool,
  sendFileTool,
  scheduleTaskTool,
  listTasksTool,
  pauseTaskTool,
  resumeTaskTool,
  cancelTaskTool,
  registerGroupTool,
  discordGetHistoryTool,
  discordGetChannelInfoTool,
  discordGetServerInfoTool,
  installSkillTool,
  uninstallSkillTool,
  memoryAppendTool,
  memorySearchTool,
  memoryGetTool,
};
