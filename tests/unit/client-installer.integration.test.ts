import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const enrollment = "uhe_0123456789abcdef_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

async function body(req: IncomingMessage): Promise<Record<string, string>> {
  let value = "";
  for await (const chunk of req) value += chunk.toString("utf8");
  return JSON.parse(value) as Record<string, string>;
}

async function runInstaller(agent: "codex" | "claude") {
  const home = await mkdtemp(path.join(os.tmpdir(), `ultimate-hermes-${agent}-`));
  let exchangeBody: Record<string, string> | null = null;
  let mcpAuthorization = "";
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
      return;
    }
    if (req.method === "POST" && req.url === "/api/v1/enrollments/exchange") {
      expect(req.headers.authorization).toBe(`Bearer ${enrollment}`);
      exchangeBody = await body(req);
      res.writeHead(201, { "content-type": "application/json" }).end(
        JSON.stringify({ ok: true, client: { label: `test-device-${agent}` } })
      );
      return;
    }
    if (req.method === "POST" && req.url === "/mcp") {
      mcpAuthorization = req.headers.authorization ?? "";
      await body(req);
      if (req.headers.accept !== "application/json, text/event-stream") {
        res.writeHead(406, { "content-type": "application/json" }).end('{"error":"Not Acceptable"}');
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end('{"jsonrpc":"2.0","id":1,"result":{}}');
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const script = path.resolve("scripts/install_mcp_client.mjs");
  const child = spawn(process.execPath, [
    script,
    "--server", `http://127.0.0.1:${port}`,
    "--enrollment", enrollment,
    "--agent", agent,
    "--name", "test-device"
  ], { env: { ...process.env, HOME: home } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
  const exitCode = await new Promise<number | null>((resolve) => child.once("close", resolve));

  try {
    expect(exitCode, stderr).toBe(0);
    const configPath = agent === "codex" ? path.join(home, ".codex", "config.toml") : path.join(home, ".claude.json");
    const config = await readFile(configPath, "utf8");
    const key = mcpAuthorization.replace(/^Bearer /, "");
    expect(key).toMatch(/^uhm_[a-f0-9]{16}_[a-f0-9]{64}$/);
    expect(config).toContain(`Bearer ${key}`);
    expect(exchangeBody).toEqual({
      keyId: key.split("_")[1],
      keyHash: createHash("sha256").update(key).digest("hex")
    });
    expect(JSON.stringify(exchangeBody)).not.toContain(key);
    expect(stdout).not.toContain(key);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(home, { recursive: true, force: true });
  }
}

describe.sequential("one-command Node client installer", () => {
  it("enrolls Codex with a locally-generated key and writes its user config", async () => {
    await runInstaller("codex");
  });

  it("enrolls Claude with a separate locally-generated key and writes its user config", async () => {
    await runInstaller("claude");
  });
});
