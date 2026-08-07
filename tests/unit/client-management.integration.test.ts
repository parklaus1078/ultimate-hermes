import { spawn } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("MCP client management CLI", () => {
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
});
