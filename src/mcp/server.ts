import { stdin as input } from "node:process";
import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { callRemoteTool } from "../remote/tools.js";

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const appendOnlyAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

const filters = {
  type: z.string().optional().describe("Optional event type filter."),
  sensitivity: z.string().optional().describe("Optional sensitivity filter."),
  project: z.string().optional().describe("Optional project/workstream filter."),
  sessionId: z.string().optional().describe("Optional calling-agent session identifier.")
};

export const mcpToolNames = [
  "recent_events",
  "recall_events",
  "timeline",
  "context_pack",
  "project_status",
  "memory_status",
  "capture_event",
  "link_source"
] as const;

function mcpContent(result: unknown) {
  if (typeof result === "string") return [{ type: "text" as const, text: result }];
  return [{ type: "text" as const, text: JSON.stringify(result, null, 2) }];
}

async function invoke(name: string, args: unknown) {
  try {
    const result = await callRemoteTool(name, args);
    return {
      content: mcpContent(result),
      ...(typeof result === "object" && result !== null ? { structuredContent: result } : {})
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Ultimate Hermes tool failed." }],
      isError: true
    };
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "ultimate-hermes", version: "0.2.0" });

  server.registerTool(
    "recent_events",
    {
      description: "List recent durable Life Archive events from the shared Supabase/Postgres memory.",
      inputSchema: { limit: z.number().int().positive().max(100).optional().describe("Maximum events, default 25.") },
      annotations: readOnlyAnnotations
    },
    async (args) => invoke("recent_events", args)
  );

  server.registerTool(
    "recall_events",
    {
      description: "Search durable memories, decisions, incidents, documents, and project history using FTS, fuzzy matching, and optional pgvector recall.",
      inputSchema: {
        query: z.string().min(1).max(1_000),
        limit: z.number().int().positive().max(50).optional().describe("Maximum matches, default 10."),
        ...filters
      },
      annotations: readOnlyAnnotations
    },
    async (args) => invoke("recall_events", args)
  );

  server.registerTool(
    "timeline",
    {
      description: "Build a chronological Life Archive timeline for a topic, project, incident, or dispute.",
      inputSchema: {
        topic: z.string().min(1).max(1_000),
        limit: z.number().int().positive().max(250).optional().describe("Maximum events, default 100."),
        ...filters
      },
      annotations: readOnlyAnnotations
    },
    async (args) => invoke("timeline", args)
  );

  server.registerTool(
    "context_pack",
    {
      description: "Generate an agent-readable Markdown context pack from the shared Ultimate Hermes memory.",
      inputSchema: {
        query: z.string().min(1).max(1_000),
        limit: z.number().int().positive().max(20).optional().describe("Maximum recalled records, default 8."),
        ...filters
      },
      annotations: readOnlyAnnotations
    },
    async (args) => invoke("context_pack", args)
  );

  server.registerTool(
    "project_status",
    {
      description: "Summarize a project's durable history, event types, recent records, and possible blockers.",
      inputSchema: {
        project: z.string().min(1).max(500),
        limit: z.number().int().positive().max(100).optional().describe("Maximum recalled records, default 20.")
      },
      annotations: readOnlyAnnotations
    },
    async (args) => invoke("project_status", args)
  );

  server.registerTool(
    "memory_status",
    {
      description: "Check canonical memory table counts and the pgvector extension version.",
      annotations: readOnlyAnnotations
    },
    async () => invoke("memory_status", {})
  );

  server.registerTool(
    "capture_event",
    {
      description: "Append a durable Life Archive event. Never include passwords, API tokens, or private keys.",
      inputSchema: {
        type: z.enum(["project", "ticket", "document", "decision", "incident", "legal", "career", "purchase", "research", "communication", "system", "source", "project_update", "event"]).default("event"),
        sensitivity: z.enum(["public", "personal", "confidential", "legal_sensitive"]).default("personal"),
        title: z.string().min(1).max(500),
        summary: z.string().max(4_000).optional(),
        body: z.string().max(20_000).optional(),
        confidence: z.enum(["human_confirmed", "imported", "agent_inferred"]).default("agent_inferred"),
        occurredAt: z.string().datetime().optional(),
        createdByProfile: z.string().max(200).optional(),
        sessionId: z.string().max(500).optional(),
        platform: z.string().max(100).optional(),
        sourceKind: z.string().max(100).optional(),
        project: z.string().max(500).optional(),
        metadata: z.record(z.unknown()).optional()
      },
      annotations: appendOnlyAnnotations
    },
    async (args) => invoke("capture_event", args)
  );

  server.registerTool(
    "link_source",
    {
      description: "Append a source or evidence reference to an existing Life Archive event.",
      inputSchema: {
        event_id: z.string().min(1),
        kind: z.string().min(1).max(100),
        source_uri: z.string().min(1).max(4_000),
        external_id: z.string().max(1_000).optional(),
        sha256: z.string().max(128).optional(),
        metadata: z.record(z.unknown()).optional()
      },
      annotations: appendOnlyAnnotations
    },
    async (args) => invoke("link_source", args)
  );

  return server;
}

export async function handleMcpHttpRequest(req: Request, res: Response): Promise<void> {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await transport.close();
    await server.close();
  };
  res.on("close", () => void close());

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32603, message: "Internal MCP server error." }
      });
    }
    throw error;
  }
}

export async function runStdioMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStdioMcpServer();
  input.resume();
}
