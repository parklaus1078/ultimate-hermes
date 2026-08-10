import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const enrollment = "uhe_0123456789abcdef_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function requestBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let value = "";
  for await (const chunk of req) value += chunk.toString("utf8");
  return JSON.parse(value) as Record<string, unknown>;
}

async function runClientCommand(argv: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [path.resolve("scripts/manage_mcp_clients.mjs"), ...argv], { env });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { exitCode, stdout, stderr };
}

describe("MCP client management CLI", () => {
  it("connects a local agent without exposing or manually copying its client key", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ultimate-hermes-simple-connect-"));
    let enrollmentAuthorization = "";
    let enrollmentBody: Record<string, unknown> = {};
    let exchangeBody: Record<string, unknown> = {};
    let clientAuthorization = "";
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/api/v1/admin/clients") {
        enrollmentAuthorization = req.headers.authorization || "";
        res.writeHead(200, { "content-type": "application/json" }).end('{"clients":[]}');
        return;
      }
      if (req.method === "POST" && req.url === "/api/v1/admin/enrollments") {
        enrollmentAuthorization = req.headers.authorization || "";
        enrollmentBody = await requestBody(req);
        res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({
          enrollment: { code: enrollment, canManageClients: true, installCommand: "unused" }
        }));
        return;
      }
      if (req.method === "GET" && req.url === "/api/v1/health") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
        return;
      }
      if (req.method === "POST" && req.url === "/api/v1/enrollments/exchange") {
        expect(req.headers.authorization).toBe(`Bearer ${enrollment}`);
        exchangeBody = await requestBody(req);
        res.writeHead(201, { "content-type": "application/json" }).end('{"client":{"label":"test-mac-codex"}}');
        return;
      }
      if (req.method === "POST" && req.url === "/mcp") {
        clientAuthorization = req.headers.authorization || "";
        await requestBody(req);
        res.writeHead(200, { "content-type": "application/json" }).end('{"jsonrpc":"2.0","id":1,"result":{}}');
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const result = await runClientCommand([
      "connect", "codex",
      "--server", `http://127.0.0.1:${port}`,
      "--device", "test-mac"
    ], { ...process.env, HOME: home, ULTIMATE_HERMES_ADMIN_TOKEN: "bootstrap-token" });

    try {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(enrollmentAuthorization).toBe("Bearer bootstrap-token");
      expect(enrollmentBody).toMatchObject({
        deviceName: "test-mac",
        agentType: "codex",
        canManageClients: false,
        grantIfNoManager: true
      });
      const key = clientAuthorization.replace(/^Bearer /, "");
      expect(key).toMatch(/^uhm_[a-f0-9]{16}_[a-f0-9]{64}$/);
      expect(exchangeBody).toEqual({
        keyId: key.split("_")[1],
        keyHash: createHash("sha256").update(key).digest("hex")
      });
      expect(await readFile(path.join(home, ".codex", "config.toml"), "utf8")).toContain(`Bearer ${key}`);
      expect(result.stdout).toContain("configured for codex");
      expect(result.stdout).toContain("can add and revoke");
      expect(result.stdout).not.toContain(key);
      expect(result.stdout).not.toContain(enrollment);
      expect(result.stderr).not.toContain(key);
      expect(result.stderr).not.toContain(enrollment);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("creates a remote pairing command by automatically finding an installed manager", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ultimate-hermes-simple-pair-"));
    let authorization = "";
    let enrollmentBody: Record<string, unknown> = {};
    const installCommand = "curl -fsSL https://example.test/installer | node --input-type=module - -- --enrollment hidden";
    const server = createServer(async (req, res) => {
      authorization = req.headers.authorization || "";
      if (req.method === "GET" && req.url === "/api/v1/admin/clients") {
        if (authorization === "Bearer installed-non-manager-key") {
          res.writeHead(403, { "content-type": "application/json" }).end(
            '{"error":"This client cannot manage MCP client keys."}'
          );
          return;
        }
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          clients: [{ status: "active", canManageClients: true }]
        }));
        return;
      }
      if (req.method === "POST" && req.url === "/api/v1/admin/enrollments") {
        enrollmentBody = await requestBody(req);
        res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({
          enrollment: { code: enrollment, canManageClients: false, installCommand }
        }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${port}`;
    await mkdir(path.join(home, ".codex"));
    await writeFile(path.join(home, ".codex", "config.toml"), [
      "[mcp_servers.ultimate-hermes]",
      `url = "${serverUrl}/mcp"`,
      'http_headers = { Authorization = "Bearer installed-non-manager-key" }',
      ""
    ].join("\n"));
    await writeFile(path.join(home, ".claude.json"), JSON.stringify({
      mcpServers: {
        "ultimate-hermes": {
          url: `${serverUrl}/mcp`,
          headers: { Authorization: "Bearer installed-manager-key" }
        }
      }
    }));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.ULTIMATE_HERMES_ADMIN_TOKEN;
    delete env.MCP_ULTIMATE_HERMES_API_KEY;
    delete env.ULTIMATE_HERMES_API_TOKEN;
    const result = await runClientCommand([
      "pair", "claude",
      "--server", serverUrl,
      "--device", "office-mac"
    ], env);

    try {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(authorization).toBe("Bearer installed-manager-key");
      expect(enrollmentBody).toMatchObject({
        deviceName: "office-mac",
        agentType: "claude",
        canManageClients: false,
        grantIfNoManager: false
      });
      expect(result.stdout.trim()).toBe(installCommand);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("never grants first-manager permission to a remote pairing unless admin is explicit", async () => {
    let enrollmentBody: Record<string, unknown> = {};
    const installCommand = "remote-install-command";
    const server = createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/api/v1/admin/clients") {
        res.writeHead(200, { "content-type": "application/json" }).end('{"clients":[]}');
        return;
      }
      if (req.method === "POST" && req.url === "/api/v1/admin/enrollments") {
        enrollmentBody = await requestBody(req);
        res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({
          enrollment: { code: enrollment, canManageClients: false, installCommand }
        }));
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const result = await runClientCommand([
      "pair", "codex",
      "--server", `http://127.0.0.1:${port}`,
      "--device", "remote-mac"
    ], { ...process.env, ULTIMATE_HERMES_ADMIN_TOKEN: "bootstrap-token" });

    try {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(enrollmentBody).toMatchObject({
        canManageClients: false,
        grantIfNoManager: false
      });
      expect(result.stdout.trim()).toBe(installCommand);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("surfaces host restrictions instead of misreporting them as missing credentials", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(403, { "content-type": "application/json" }).end('{"error":"Host is not allowed."}');
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const result = await runClientCommand([
      "pair", "codex",
      "--server", `http://127.0.0.1:${port}`,
      "--device", "new-mac"
    ], { ...process.env, ULTIMATE_HERMES_ADMIN_TOKEN: "manager-key" });

    try {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Host is not allowed.");
      expect(result.stderr).not.toContain("No working manager key was found");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("does not create another key when the target agent is already connected", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ultimate-hermes-existing-connect-"));
    let enrollmentCalls = 0;
    const server = createServer(async (req, res) => {
      if (req.method === "POST" && req.url === "/mcp") {
        expect(req.headers.authorization).toBe("Bearer existing-client-key");
        await requestBody(req);
        res.writeHead(200, { "content-type": "application/json" }).end('{"jsonrpc":"2.0","id":1,"result":{}}');
        return;
      }
      if (req.url?.includes("enrollment")) enrollmentCalls += 1;
      res.writeHead(404).end();
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${port}`;
    await mkdir(path.join(home, ".codex"));
    await writeFile(path.join(home, ".codex", "config.toml"), [
      "[mcp_servers.ultimate-hermes]",
      `url = "${serverUrl}/mcp"`,
      'http_headers = { Authorization = "Bearer existing-client-key" }',
      ""
    ].join("\n"));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.ULTIMATE_HERMES_ADMIN_TOKEN;
    const result = await runClientCommand([
      "connect", "codex",
      "--server", serverUrl,
      "--device", "test-mac"
    ], env);

    try {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(enrollmentCalls).toBe(0);
      expect(result.stdout).toContain("already connected");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("never sends an auto-discovered key to a different server", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ultimate-hermes-origin-binding-"));
    await mkdir(path.join(home, ".codex"));
    await writeFile(path.join(home, ".codex", "config.toml"), [
      "[mcp_servers.ultimate-hermes]",
      'url = "https://trusted.example/mcp"',
      'http_headers = { Authorization = "Bearer must-not-leak" }',
      ""
    ].join("\n"));
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(200, { "content-type": "application/json" }).end('{"clients":[]}');
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.ULTIMATE_HERMES_ADMIN_TOKEN;
    delete env.MCP_ULTIMATE_HERMES_API_KEY;
    delete env.ULTIMATE_HERMES_API_TOKEN;
    const result = await runClientCommand([
      "list", "--server", `http://127.0.0.1:${port}`
    ], env);

    try {
      expect(result.exitCode).toBe(1);
      expect(requests).toBe(0);
      expect(result.stderr).toContain("No working manager key was found");
      expect(result.stderr).not.toContain("must-not-leak");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("rejects insecure remote server URLs before using a credential", async () => {
    const result = await runClientCommand([
      "list", "--server", "http://untrusted.example"
    ], { ...process.env, ULTIMATE_HERMES_ADMIN_TOKEN: "must-not-leak" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("must use HTTPS");
    expect(result.stderr).not.toContain("must-not-leak");
  });

  it("surfaces a malformed Claude config when no other manager credential works", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ultimate-hermes-malformed-claude-"));
    await writeFile(path.join(home, ".claude.json"), "{not-json");
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.ULTIMATE_HERMES_ADMIN_TOKEN;
    delete env.MCP_ULTIMATE_HERMES_API_KEY;
    delete env.ULTIMATE_HERMES_API_TOKEN;
    const result = await runClientCommand(["list"], env);

    try {
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(`Cannot parse ${path.join(home, ".claude.json")}`);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it("reports an undeployed enrollment API instead of parsing HTML as JSON", async () => {
    const server = createServer((req, res) => {
      if (req.method === "GET" && req.url === "/") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"service":"ultimate-hermes","version":"0.2.0"}');
        return;
      }
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><pre>Cannot POST /api/v1/admin/enrollments</pre>");
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const child = spawn(process.execPath, [
      path.resolve("scripts/manage_mcp_clients.mjs"),
      "create",
      "--server", `http://127.0.0.1:${port}`,
      "--device", "macbook-home",
      "--agent", "codex"
    ], {
      env: { ...process.env, ULTIMATE_HERMES_ADMIN_TOKEN: "test-token" }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));

    try {
      expect(exitCode).toBe(1);
      expect(stderr).toContain("does not provide /api/v1/admin/enrollments");
      expect(stderr).toContain("It is running Ultimate Hermes 0.2.0");
      expect(stderr).toContain("deploy Ultimate Hermes 0.3.0");
      expect(stderr).not.toContain("SyntaxError");
      expect(stderr).not.toContain("Unexpected token");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("honors an explicit auth-agent instead of an ambient shared or manager token", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ultimate-hermes-client-auth-"));
    let authorization = "";
    const server = createServer((req, res) => {
      authorization = req.headers.authorization || "";
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"clients":[]}');
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${port}`;
    await mkdir(path.join(home, ".codex"));
    await writeFile(path.join(home, ".codex", "config.toml"), [
      "[mcp_servers.other]",
      'url = "https://other.example/mcp"',
      "",
      "[mcp_servers.ultimate-hermes]",
      `url = "${serverUrl}/mcp"`,
      'http_headers = { Authorization = "Bearer selected-codex-token" }',
      "",
      "[desktop]",
      'conversationDetailMode = "STEPS_COMMANDS"',
      ""
    ].join("\n"));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      MCP_ULTIMATE_HERMES_API_KEY: "ambient-manager-token",
      ULTIMATE_HERMES_API_TOKEN: "ambient-legacy-token"
    };
    delete env.ULTIMATE_HERMES_ADMIN_TOKEN;
    const child = spawn(process.execPath, [
      path.resolve("scripts/manage_mcp_clients.mjs"),
      "list",
      "--server", serverUrl,
      "--auth-agent", "codex"
    ], { env });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));

    try {
      expect(exitCode, stderr).toBe(0);
      expect(authorization).toBe("Bearer selected-codex-token");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });

  it("discovers a Hermes manager key only with its matching configured server", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ultimate-hermes-hermes-auth-"));
    let authorization = "";
    const server = createServer((req, res) => {
      authorization = req.headers.authorization || "";
      res.writeHead(200, { "content-type": "application/json" }).end('{"clients":[]}');
    });
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const serverUrl = `http://127.0.0.1:${port}`;
    const hermesHome = path.join(home, ".hermes");
    await mkdir(hermesHome);
    await writeFile(path.join(hermesHome, ".env"), "MCP_ULTIMATE_HERMES_API_KEY=hermes-manager-key\n");
    await writeFile(path.join(hermesHome, "config.yaml"), [
      "mcp_servers:",
      "  ultimate-hermes:",
      `    url: ${serverUrl}/mcp`,
      "    enabled: true",
      ""
    ].join("\n"));
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home };
    delete env.ULTIMATE_HERMES_ADMIN_TOKEN;
    const result = await runClientCommand([
      "list", "--server", serverUrl, "--auth-agent", "hermes"
    ], env);

    try {
      expect(result.exitCode, result.stderr).toBe(0);
      expect(authorization).toBe("Bearer hermes-manager-key");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(home, { recursive: true, force: true });
    }
  });
});
