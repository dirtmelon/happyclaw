#!/usr/bin/env node
/**
 * happyclaw-mcp-server — standalone stdio MCP server exposing the 17
 * built-in HappyClaw tools (send_message, schedule_task, memory_*, etc.).
 *
 * Consumed by both:
 *   - container/agent-runner (Claude path) via mcpServers.happyclaw
 *     entry { command: 'node', args: ['/path/to/dist/index.js', ...] }
 *   - container/cursor-runner (future Cursor path) via the same mechanism
 *
 * Static context is parsed from CLI flags at startup. The mutable subset
 * (chatJid / currentTaskId / isScheduledTask) is loaded on every tool call
 * from `<workspaceIpc>/current-context.json`, which the runner main process
 * atomic-writes between IPC turns.
 *
 * stderr is reserved for diagnostic logging only — stdio is the MCP
 * transport channel and must not be polluted.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { buildMcpContext, parseStaticContext } from './context.js';
import type { StaticContext } from './context.js';
import { getActiveTools } from './tools.js';
import type { ToolDef } from './tools.js';

function log(message: string): void {
  process.stderr.write(`[happyclaw-mcp-server] ${message}\n`);
}

function zodSchemaToJson(schema: z.ZodType<unknown>): Record<string, unknown> {
  // zod 4 ships z.toJSONSchema as a top-level helper.
  // Output shape matches the JSON Schema dialect MCP expects (object with
  // "type": "object", "properties": {...}, "required": [...]).
  const json = (z as unknown as { toJSONSchema: (s: z.ZodType<unknown>) => unknown }).toJSONSchema(schema);
  if (json && typeof json === 'object') {
    return json as Record<string, unknown>;
  }
  // Fallback to a permissive object schema if conversion fails — better
  // than crashing on startup.
  return { type: 'object', additionalProperties: true };
}

async function main(): Promise<void> {
  let staticCtx: StaticContext;
  try {
    staticCtx = parseStaticContext(process.argv);
  } catch (err) {
    log(`Failed to parse startup flags: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const tools = getActiveTools(staticCtx);
  log(
    `Started with groupFolder=${staticCtx.groupFolder} ` +
    `isHome=${staticCtx.isHome} isAdminHome=${staticCtx.isAdminHome} ` +
    `disableMemoryLayer=${staticCtx.disableMemoryLayer} ` +
    `tools=${tools.length} (${tools.map((t) => t.name).join(',')})`,
  );

  const toolByName = new Map<string, ToolDef<unknown>>();
  for (const t of tools) toolByName.set(t.name, t);

  const server = new Server(
    { name: 'happyclaw', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodSchemaToJson(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: rawArgs } = req.params;
    const tool = toolByName.get(name);
    if (!tool) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${name}`,
      );
    }

    let validatedArgs: unknown;
    try {
      validatedArgs = tool.inputSchema.parse(rawArgs ?? {});
    } catch (err) {
      const message =
        err instanceof z.ZodError
          ? err.issues
              .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
              .join('; ')
          : err instanceof Error
            ? err.message
            : String(err);
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments for ${name}: ${message}`,
      );
    }

    const ctx = buildMcpContext(staticCtx);
    try {
      const result = await tool.handler(validatedArgs, ctx);
      return {
        content: result.content,
        ...(result.isError ? { isError: true } : {}),
      };
    } catch (err) {
      log(`Tool ${name} threw: ${err instanceof Error ? err.stack || err.message : String(err)}`);
      return {
        content: [
          {
            type: 'text',
            text: `Internal error in ${name}: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('Connected over stdio, ready for requests.');
}

main().catch((err) => {
  log(`Fatal startup error: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
