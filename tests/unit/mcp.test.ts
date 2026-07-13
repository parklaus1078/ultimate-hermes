import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { handleMcpRequest } from "../../src/mcp/server.js";

describe("Ultimate Hermes MCP server", () => {
  it("advertises Life Archive tools", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    expect(response?.error).toBeUndefined();
    const result = response?.result as { tools: Array<{ name: string }> };
    expect(result.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["recent_events", "recall_events", "timeline", "context_pack", "capture_event"])
    );
  });

  it("responds to initialize with tool capabilities", async () => {
    const response = await handleMcpRequest({ jsonrpc: "2.0", id: "init", method: "initialize" });

    expect(response?.result).toMatchObject({
      capabilities: { tools: {} },
      serverInfo: { name: "ultimate-hermes" }
    });
  });

  it("uses MCP stdio Content-Length framing", async () => {
    const child = spawn(process.execPath, ["dist/src/mcp/server.js"], { stdio: ["pipe", "pipe", "pipe"] });
    const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    child.stdin.write(`Content-Length: ${Buffer.byteLength(request)}\r\n\r\n${request}`);

    const response = await new Promise<string>((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for MCP stdio response")), 2000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const header = buffer.subarray(0, headerEnd).toString("ascii");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) return;
        const bodyStart = headerEnd + 4;
        const bodyEnd = bodyStart + Number.parseInt(match[1]!, 10);
        if (buffer.length < bodyEnd) return;
        clearTimeout(timeout);
        resolve(buffer.subarray(bodyStart, bodyEnd).toString("utf8"));
      });
      child.on("error", reject);
    });

    child.kill();
    expect(JSON.parse(response)).toMatchObject({ result: { serverInfo: { name: "ultimate-hermes" } } });
  });
});
