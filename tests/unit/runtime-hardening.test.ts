import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config/env.js";
import { requiredSchemaMigration } from "../../src/db/client.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe.sequential("runtime database hardening", () => {
  it("prefers the isolated runtime DSN during a reversible credential rollout", () => {
    process.env.HERMES_DATABASE_URL = "postgres://migration-owner.example/postgres";
    process.env.HERMES_RUNTIME_DATABASE_URL = "postgres://hermes-runtime.example/postgres";
    expect(loadConfig().databaseUrl).toBe("postgres://hermes-runtime.example/postgres");
  });

  it("ships the Supabase CA for verify-full runtime connections", async () => {
    const certificate = await readFile(
      new URL("../../certs/prod-ca-2021.crt", import.meta.url),
      "utf8"
    );
    const dockerfile = await readFile(new URL("../../Dockerfile", import.meta.url), "utf8");
    expect(certificate).toContain("-----BEGIN CERTIFICATE-----");
    expect(dockerfile).toContain("certs/prod-ca-2021.crt");
    expect(dockerfile).toContain("scripts/install_mcp_client.mjs");
    expect(dockerfile).toContain("scripts/install_mcp_client.py");
  });

  it("sends the Streamable HTTP Accept header from both installers", async () => {
    const nodeInstaller = await readFile(new URL("../../scripts/install_mcp_client.mjs", import.meta.url), "utf8");
    const pythonInstaller = await readFile(new URL("../../scripts/install_mcp_client.py", import.meta.url), "utf8");
    expect(nodeInstaller).toContain('Accept: "application/json, text/event-stream"');
    expect(pythonInstaller).toContain('accept="application/json, text/event-stream"');
  });

  it("starts the web process with a read-only schema check instead of migrations", async () => {
    const serverSource = await readFile(new URL("../../src/server/index.ts", import.meta.url), "utf8");
    expect(serverSource).toContain("await assertSchemaReady()");
    expect(serverSource).not.toMatch(/\bawait\s+migrate\s*\(/);
  });

  it("grants only the operations used by the remote MCP service", async () => {
    const runtimeMigration = await readFile(
      new URL("../../src/db/migrations/0005_runtime_role_hardening.sql", import.meta.url),
      "utf8"
    );
    const clientMigration = await readFile(
      new URL("../../src/db/migrations/0006_mcp_client_auth.sql", import.meta.url),
      "utf8"
    );

    expect(runtimeMigration).toContain("nobypassrls");
    expect(runtimeMigration).toContain("grant insert on table");
    expect(runtimeMigration).toContain("public.life_events");
    expect(runtimeMigration).toContain("public.life_recall_hits");
    expect(runtimeMigration).toContain("grant update, delete on table public.life_embeddings");
    expect(clientMigration).toContain("enable row level security");
    expect(clientMigration).toContain("grant update (status, revoked_at, last_seen_at, updated_at)");
    expect(clientMigration).toContain("revoke all privileges on table");
    expect(`${runtimeMigration}\n${clientMigration}`).not.toMatch(/grant\s+all/i);
    expect(`${runtimeMigration}\n${clientMigration}`).not.toMatch(/grant\s+(create|truncate)/i);
  });
});
