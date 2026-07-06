import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config/env.js";

const { Pool } = pg;

export type Db = pg.Pool;

let pool: pg.Pool | undefined;

export function getDb(): Db {
  if (!pool) {
    pool = new Pool({
      connectionString: loadConfig().databaseUrl
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

function migrationsDir(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.join(current, "migrations");
  if (existsSync(distPath)) return distPath;
  return path.resolve(process.cwd(), "src/db/migrations");
}

export async function migrate(): Promise<string[]> {
  const dir = migrationsDir();
  const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
  const applied: string[] = [];

  await query("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");

  for (const file of files) {
    const already = await query("select id from schema_migrations where id = $1", [file]);
    if (already.rowCount) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("insert into schema_migrations (id) values ($1)", [file]);
    });
    applied.push(file);
  }

  return applied;
}
