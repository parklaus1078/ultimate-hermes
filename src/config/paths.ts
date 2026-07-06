import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "./env.js";

export function dataDir(): string {
  return path.resolve(process.cwd(), loadConfig().dataDir);
}

export async function ensureDataDir(): Promise<string> {
  const dir = dataDir();
  await mkdir(dir, { recursive: true });
  return dir;
}

export function evidenceDir(): string {
  return path.join(dataDir(), "evidence");
}
