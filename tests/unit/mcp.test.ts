import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer, mcpToolNames } from "../../src/mcp/server.js";
import { createApp } from "../../src/server/app.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe.sequential("Ultimate Hermes MCP server", () => {
  it("registers the shared Life Archive tool surface", () => {
    const server = createMcpServer();
    expect(mcpToolNames).toEqual(
      expect.arrayContaining([
        "recent_events",
        "recall_events",
        "timeline",
        "context_pack",
        "project_status",
        "memory_status",
        "capture_event",
        "link_source"
      ])
    );
    void server.close();
  });

  it("uses official MCP stdio newline framing", async () => {
    const child = spawn(process.execPath, ["dist/src/mcp/server.js"], { stdio: ["pipe", "pipe", "pipe"] });
    const request = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "ultimate-hermes-test", version: "1.0.0" }
      }
    });
    child.stdin.write(`${request}\n`);

    const response = await new Promise<string>((resolve, reject) => {
      let buffer = "";
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for MCP stdio response")), 3_000);
      child.stdout.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        clearTimeout(timeout);
        resolve(buffer.slice(0, newline));
      });
      child.on("error", reject);
    });

    child.kill();
    expect(JSON.parse(response)).toMatchObject({ result: { serverInfo: { name: "ultimate-hermes" } } });
  });

  it("serves authenticated stateless Streamable HTTP", async () => {
    process.env.NODE_ENV = "test";
    process.env.HERMES_HOST = "127.0.0.1";
    process.env.HERMES_API_TOKEN = "test-token";
    process.env.HERMES_ACCEPT_LEGACY_API_TOKEN = "true";
    const listener = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    const { port } = listener.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/mcp`;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "init",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "ultimate-hermes-http-test", version: "1.0.0" }
      }
    });

    try {
      const unauthorized = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        body
      });
      expect(unauthorized.status).toBe(401);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ result: { serverInfo: { name: "ultimate-hermes" } } });
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rejects browser origins unless they are explicitly allowed", async () => {
    process.env.NODE_ENV = "test";
    process.env.HERMES_HOST = "127.0.0.1";
    process.env.HERMES_API_TOKEN = "test-token";
    process.env.HERMES_ACCEPT_LEGACY_API_TOKEN = "true";
    const listener = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    const { port } = listener.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json",
          origin: "https://untrusted.example"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" })
      });
      expect(response.status).toBe(403);
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("blocks repeated authentication failures without trusting the leftmost forwarded address", async () => {
    process.env.NODE_ENV = "test";
    process.env.HERMES_HOST = "127.0.0.1";
    process.env.HERMES_API_TOKEN = "test-token";
    process.env.HERMES_ACCEPT_LEGACY_API_TOKEN = "true";
    process.env.HERMES_TRUST_PROXY_HOPS = "1";
    process.env.HERMES_AUTH_RATE_LIMIT_MAX_FAILURES = "3";
    process.env.HERMES_AUTH_RATE_LIMIT_WINDOW_MS = "60000";
    process.env.HERMES_AUTH_RATE_LIMIT_BLOCK_MS = "120000";
    const listener = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    const { port } = listener.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/mcp`;
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "rate-limit",
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "rate-limit-test", version: "1.0.0" }
      }
    });
    const request = (authorization: string, forwardedFor: string) => fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${authorization}`,
        "content-type": "application/json",
        "x-forwarded-for": forwardedFor
      },
      body
    });

    try {
      expect((await request("wrong-1", "198.51.100.1, 203.0.113.10")).status).toBe(401);
      expect((await request("wrong-2", "198.51.100.2, 203.0.113.10")).status).toBe(401);
      const blocked = await request("wrong-3", "198.51.100.3, 203.0.113.10");
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get("retry-after")).toBe("120");

      expect((await request("test-token", "198.51.100.4, 203.0.113.10")).status).toBe(429);
      expect((await request("test-token", "198.51.100.4, 203.0.113.11")).status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });
});
