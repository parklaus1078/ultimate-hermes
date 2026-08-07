import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig, loadMigrationDatabaseUrl } from "../config/env.js";

const { Pool } = pg;

export type Db = pg.Pool;

let pool: pg.Pool | undefined;

export const requiredSchemaMigration = "0005_runtime_role_hardening.sql";

export function getDb(): Db {
  if (!pool) {
    const config = loadConfig();
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: config.databaseMaxConnections,
      connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
      idleTimeoutMillis: config.databaseIdleTimeoutMs,
      application_name: "ultimate-hermes"
    });
  }
  return pool;
}

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  return getDb().query<T>(text, params);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getDb().connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function assertSchemaReady(): Promise<void> {
  const result = await query<{ ready: boolean }>(
    "select exists (select 1 from public.schema_migrations where id = $1) as ready",
    [requiredSchemaMigration]
  );
  if (!result.rows[0]?.ready) {
    throw new Error(
      `Database schema is not ready. Apply migrations through ${requiredSchemaMigration} with the migration-only credential.`
    );
  }
}

function migrationsDir(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(current, "migrations");
  if (existsSync(distPath)) return distPath;
  return path.resolve(process.cwd(), "src/db/migrations");
}

export async function migrate(): Promise<string[]> {
  const config = loadConfig();
  const migrationPool = new Pool({
    connectionString: loadMigrationDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: config.databaseConnectionTimeoutMs,
    idleTimeoutMillis: config.databaseIdleTimeoutMs,
    application_name: "ultimate-hermes-migrations"
  });
  const client = await migrationPool.connect();
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  const applied: string[] = [];

  try {
    await client.query("select pg_advisory_lock(hashtext('ultimate-hermes:migrations'))");
    await client.query("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");

    for (const file of files) {
      const already = await client.query("select id from schema_migrations where id = $1", [file]);
      if (already.rowCount) continue;
      const sql = await readFile(path.join(dir, file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (id) values ($1)", [file]);
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
      applied.push(file);
    }
  } finally {
    try {
      await client.query("select pg_advisory_unlock(hashtext('ultimate-hermes:migrations'))");
    } finally {
      client.release();
      await migrationPool.end();
    }
  }

  return applied;
}
