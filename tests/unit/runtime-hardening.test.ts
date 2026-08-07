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
  });

  it("starts the web process with a read-only schema check instead of migrations", async () => {
    const serverSource = await readFile(new URL("../../src/server/index.ts", import.meta.url), "utf8");
    expect(serverSource).toContain("await assertSchemaReady()");
    expect(serverSource).not.toMatch(/\bawait\s+migrate\s*\(/);
  });

  it("grants only the operations used by the remote MCP service", async () => {
    const migration = await readFile(
      new URL(`../../src/db/migrations/${requiredSchemaMigration}`, import.meta.url),
      "utf8"
    );

    expect(migration).toContain("nobypassrls");
    expect(migration).toContain("grant insert on table");
    expect(migration).toContain("public.life_events");
    expect(migration).toContain("public.life_recall_hits");
    expect(migration).toContain("grant update, delete on table public.life_embeddings");
    expect(migration).not.toMatch(/grant\s+all/i);
    expect(migration).not.toMatch(/grant\s+(create|truncate)/i);
  });
});
