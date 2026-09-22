import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpServer, mcpToolNames } from "../../src/mcp/server.js";
import { createApp } from "../../src/server/app.js";
import {
  AuthorizationError,
  LIFE_ARCHIVE_ADMIN_SCOPE,
  LIFE_ARCHIVE_READ_SCOPE,
  LIFE_ARCHIVE_WRITE_SCOPE,
  type AccessTokenVerifier
} from "../../src/remote/auth0.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const verifyTestToken: AccessTokenVerifier = async (token) => {
  if (token !== "test-token") throw new AuthorizationError("Invalid test access token.");
  return {
    id: null,
    keyId: "auth0:test-owner",
    label: "test-owner",
    deviceName: "test-client",
    agentType: "other",
    canManageClients: true,
    authentication: "auth0-oauth",
    subject: "auth0|test-owner",
    scopes: [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE],
    permissions: [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE],
    authInfo: {
      token,
      clientId: "test-client",
      scopes: [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE],
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      resource: new URL("https://life-archive.example.com/mcp")
    }
  };
};

const verifyReadOnlyToken: AccessTokenVerifier = async (token) => {
  const client = await verifyTestToken(token);
  return {
    ...client,
    canManageClients: false,
    scopes: [LIFE_ARCHIVE_READ_SCOPE],
    authInfo: client.authInfo ? { ...client.authInfo, scopes: [LIFE_ARCHIVE_READ_SCOPE] } : undefined
  };
};

describe.sequential("Life Archive MCP server", () => {
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
    expect(JSON.parse(response)).toMatchObject({ result: { serverInfo: { name: "life-archive" } } });
  });

  it("serves Auth0-authenticated stateless Streamable HTTP", async () => {
    process.env.NODE_ENV = "test";
    process.env.HERMES_HOST = "127.0.0.1";
    const listener = createApp({ verifyAccessToken: verifyTestToken }).listen(0, "127.0.0.1");
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
      const discovery = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        body
      });
      expect(discovery.status).toBe(200);
      expect(await discovery.json()).toMatchObject({ result: { serverInfo: { name: "life-archive" } } });

      const initialized = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
      });
      expect(initialized.status).toBe(202);

      const unauthorized = await fetch(url, {
        method: "POST",
        headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "ping", method: "ping" })
      });
      expect(unauthorized.status).toBe(401);
      expect(unauthorized.headers.get("www-authenticate")).toContain("resource_metadata=");

      for (const payload of [
        { jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: "recent_events", arguments: {} } },
        [
          { jsonrpc: "2.0", id: "init", method: "initialize", params: {} },
          { jsonrpc: "2.0", id: "call", method: "tools/call", params: { name: "recent_events", arguments: {} } }
        ]
      ]) {
        const denied = await fetch(url, {
          method: "POST",
          headers: { accept: "application/json, text/event-stream", "content-type": "application/json" },
          body: JSON.stringify(payload)
        });
        expect(denied.status).toBe(401);
      }

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
      expect(await response.json()).toMatchObject({ result: { serverInfo: { name: "life-archive" } } });

      const toolsResponse = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json"
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: "tools", method: "tools/list" })
      });
      expect(toolsResponse.status).toBe(200);
      const toolsBody = await toolsResponse.json() as {
        result: { tools: Array<{ name: string; securitySchemes?: Array<{ type: string; scopes: string[] }> }> };
      };
      expect(toolsBody.result.tools).toHaveLength(mcpToolNames.length);
      for (const tool of toolsBody.result.tools) {
        expect(tool.securitySchemes).toEqual([{
          type: "oauth2",
          scopes: tool.name === "capture_event" || tool.name === "link_source"
            ? [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE]
            : [LIFE_ARCHIVE_READ_SCOPE]
        }]);
      }
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("publishes OAuth discovery and enforces write scope", async () => {
    process.env.NODE_ENV = "test";
    process.env.HERMES_HOST = "127.0.0.1";
    process.env.HERMES_PUBLIC_BASE_URL = "https://life-archive.example.com";
    process.env.LIFE_ARCHIVE_AUTH0_ISSUER = "https://life-archive-test.us.auth0.com/";
    process.env.LIFE_ARCHIVE_AUTH0_AUDIENCE = "https://life-archive.example.com/mcp";
    const listener = createApp({ verifyAccessToken: verifyReadOnlyToken }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    const { port } = listener.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      const metadata = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
      expect(metadata.status).toBe(200);
      const metadataBody = await metadata.json() as { scopes_supported?: string[] };
      expect(metadataBody).toMatchObject({
        resource: "https://life-archive.example.com/mcp",
        authorization_servers: ["https://life-archive.example.com"],
        scopes_supported: expect.arrayContaining([
          LIFE_ARCHIVE_READ_SCOPE,
          LIFE_ARCHIVE_WRITE_SCOPE
        ])
      });
      expect(metadataBody.scopes_supported).not.toContain("offline_access");

      const authorizationMetadata = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
      expect(authorizationMetadata.status).toBe(200);
      const authorizationBody = await authorizationMetadata.json() as {
        issuer: string;
        authorization_endpoint: string;
        token_endpoint: string;
        registration_endpoint: string;
        authorization_response_iss_parameter_supported?: boolean;
        scopes_supported: string[];
      };
      expect(authorizationBody).toMatchObject({
        issuer: "https://life-archive.example.com",
        token_endpoint: "https://life-archive-test.us.auth0.com/oauth/token",
        registration_endpoint: "https://life-archive-test.us.auth0.com/oidc/register",
        authorization_response_iss_parameter_supported: false,
        scopes_supported: expect.arrayContaining([
          LIFE_ARCHIVE_READ_SCOPE,
          LIFE_ARCHIVE_WRITE_SCOPE,
          LIFE_ARCHIVE_ADMIN_SCOPE,
          "offline_access"
        ])
      });
      const authorizationUrl = new URL(authorizationBody.authorization_endpoint);
      expect(`${authorizationUrl.origin}${authorizationUrl.pathname}`).toBe(
        "https://life-archive-test.us.auth0.com/authorize"
      );
      expect(authorizationUrl.searchParams.get("audience")).toBe(
        "https://life-archive.example.com/mcp"
      );

      const deniedWrite = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "write-denied",
          method: "tools/call",
          params: { name: "capture_event", arguments: { title: "must not reach the tool" } }
        })
      });
      expect(deniedWrite.status).toBe(403);
      expect(deniedWrite.headers.get("www-authenticate")).toContain("insufficient_scope");
      expect(await deniedWrite.json()).toMatchObject({ requiredScopes: [LIFE_ARCHIVE_WRITE_SCOPE] });

      const deniedBatchWrite = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json"
        },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: "read", method: "tools/list" },
          {
            jsonrpc: "2.0",
            id: "write",
            method: "tools/call",
            params: { name: "link_source", arguments: {} }
          }
        ])
      });
      expect(deniedBatchWrite.status).toBe(403);

      const retiredKeys = await fetch(`${baseUrl}/api/v1/admin/clients`);
      expect(retiredKeys.status).toBe(410);
      const retiredInstaller = await fetch(`${baseUrl}/api/v1/installers/mcp-client.mjs`);
      expect(retiredInstaller.status).toBe(410);

      const deniedAdmin = await fetch(`${baseUrl}/api/v1/admin/request-logs`, {
        headers: { authorization: "Bearer test-token" }
      });
      expect(deniedAdmin.status).toBe(403);
      expect(await deniedAdmin.json()).toMatchObject({ requiredScopes: [LIFE_ARCHIVE_ADMIN_SCOPE] });
    } finally {
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("logs the rejected MCP operation without credentials or request data", async () => {
    process.env.NODE_ENV = "test";
    process.env.HERMES_HOST = "127.0.0.1";
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listener = createApp({ verifyAccessToken: verifyTestToken }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    const { port } = listener.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer diagnostic-secret",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "private-id",
          method: "tools/call",
          params: { name: "capture_event", arguments: { title: "private-memory" } }
        })
      });
      expect(response.status).toBe(401);
      const warning = warnings.mock.calls.map(([line]) => String(line)).find((line) => line.includes('"event":"mcp_auth_rejected"'));
      expect(warning).toBeDefined();
      expect(JSON.parse(warning!)).toMatchObject({ operation: "tools/call", authorizationPresent: true });
      expect(warning).not.toContain("diagnostic-secret");
      expect(warning).not.toContain("private-memory");
      expect(warning).not.toContain("private-id");
    } finally {
      warnings.mockRestore();
      await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("rejects browser origins unless they are explicitly allowed", async () => {
    process.env.NODE_ENV = "test";
    process.env.HERMES_HOST = "127.0.0.1";
    const listener = createApp({ verifyAccessToken: verifyTestToken }).listen(0, "127.0.0.1");
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
    process.env.HERMES_TRUST_PROXY_HOPS = "1";
    process.env.HERMES_AUTH_RATE_LIMIT_MAX_FAILURES = "3";
    process.env.HERMES_AUTH_RATE_LIMIT_WINDOW_MS = "60000";
    process.env.HERMES_AUTH_RATE_LIMIT_BLOCK_MS = "120000";
    const listener = createApp({ verifyAccessToken: verifyTestToken }).listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => listener.once("listening", resolve));
    const { port } = listener.address() as AddressInfo;
    const url = `http://127.0.0.1:${port}/mcp`;
    const body = JSON.stringify({ jsonrpc: "2.0", id: "rate-limit", method: "ping" });
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
