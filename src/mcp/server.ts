import { stdin as input, stdout as output } from "node:process";
import { callRemoteTool } from "../remote/tools.js";

type JsonRpcRequest = {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

const protocolVersion = "2024-11-05";

const toolDefinitions = [
  {
    name: "recent_events",
    description: "List recent Life Archive events from Ultimate Hermes/Postgres.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Maximum events to return, default 25." } }
    }
  },
  {
    name: "recall_events",
    description: "Search Life Archive/Postgres for durable memories, decisions, incidents, and project history.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Maximum matches to return, default 10." }
      },
      required: ["query"]
    }
  },
  {
    name: "timeline",
    description: "Build a chronological Life Archive timeline for a topic/project.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string" },
        limit: { type: "number", description: "Maximum events to return, default 100." }
      },
      required: ["topic"]
    }
  },
  {
    name: "context_pack",
    description: "Generate an agent-readable Markdown context pack from shared Ultimate Hermes data.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Maximum recalled records, default 8." }
      },
      required: ["query"]
    }
  },
  {
    name: "capture_event",
    description: "Write a new durable Life Archive event. Use only when the user/current policy explicitly allows writes.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string" },
        sensitivity: { type: "string" },
        title: { type: "string" },
        summary: { type: "string" },
        body: { type: "string" },
        confidence: { type: "string" },
        occurredAt: { type: "string" },
        createdByProfile: { type: "string" },
        metadata: { type: "object" }
      },
      required: ["type", "title"]
    }
  }
];

function success(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function failure(id: JsonRpcRequest["id"], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function mcpContent(result: unknown) {
  if (typeof result === "string") return [{ type: "text", text: result }];
  return [{ type: "text", text: JSON.stringify(result, null, 2) }];
}

export async function handleMcpRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (request.id === undefined && request.method?.startsWith("notifications/")) return null;

  switch (request.method) {
    case "initialize":
      return success(request.id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "ultimate-hermes", version: "0.1.0" }
      });
    case "ping":
      return success(request.id, {});
    case "tools/list":
      return success(request.id, { tools: toolDefinitions });
    case "tools/call": {
      const params = request.params ?? {};
      const name = params.name;
      if (typeof name !== "string") return failure(request.id, -32602, "tools/call requires params.name");
      const result = await callRemoteTool(name, params.arguments ?? {});
      return success(request.id, { content: mcpContent(result), isError: false });
    }
    default:
      return failure(request.id, -32601, `Unknown MCP method: ${request.method ?? "<missing>"}`);
  }
}

function encodeMessage(message: JsonRpcResponse): string {
  const json = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

function headerLength(buffer: Buffer): { headerEnd: number; separatorLength: number } | null {
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf >= 0) return { headerEnd: crlf, separatorLength: 4 };
  const lf = buffer.indexOf("\n\n");
  if (lf >= 0) return { headerEnd: lf, separatorLength: 2 };
  return null;
}

function contentLengthFromHeader(header: string): number {
  const match = header.match(/(?:^|\r?\n)Content-Length:\s*(\d+)/i);
  if (!match) throw new Error("Missing Content-Length header");
  return Number.parseInt(match[1]!, 10);
}

export async function runStdioMcpServer(): Promise<void> {
  let buffer = Buffer.alloc(0);

  input.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      const header = headerLength(buffer);
      if (!header) return;

      let length: number;
      try {
        length = contentLengthFromHeader(buffer.subarray(0, header.headerEnd).toString("ascii"));
      } catch (error) {
        output.write(encodeMessage(failure(null, -32600, error instanceof Error ? error.message : String(error))));
        buffer = Buffer.alloc(0);
        return;
      }

      const bodyStart = header.headerEnd + header.separatorLength;
      const bodyEnd = bodyStart + length;
      if (buffer.length < bodyEnd) return;

      const body = buffer.subarray(bodyStart, bodyEnd).toString("utf8");
      buffer = buffer.subarray(bodyEnd);

      void handleBody(body);
    }
  });

  await new Promise<void>((resolve) => input.on("end", resolve));
}

async function handleBody(body: string): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(body) as JsonRpcRequest;
  } catch (error) {
    output.write(encodeMessage(failure(null, -32700, error instanceof Error ? error.message : String(error))));
    return;
  }

  try {
    const response = await handleMcpRequest(request);
    if (response) output.write(encodeMessage(response));
  } catch (error) {
    output.write(encodeMessage(failure(request.id, -32000, error instanceof Error ? error.message : String(error))));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runStdioMcpServer();
}
