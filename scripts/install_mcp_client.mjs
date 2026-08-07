#!/usr/bin/env node
import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SERVER_NAME = "ultimate-hermes";

function parseArgs(argv) {
  const args = {};
  const values = argv[0] === "--" ? argv.slice(1) : argv;
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index];
    if (!name?.startsWith("--")) throw new Error(`Unexpected argument: ${name}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`);
    args[name.slice(2)] = value;
    index += 1;
  }
  return args;
}

function normalizeServer(value) {
  const server = new URL(value);
  const local = ["127.0.0.1", "localhost", "::1"].includes(server.hostname);
  if (server.protocol !== "https:" && !(server.protocol === "http:" && local)) {
    throw new Error("The server must use HTTPS (HTTP is allowed only for localhost). ");
  }
  server.pathname = server.pathname.replace(/\/mcp\/?$/, "").replace(/\/$/, "");
  server.search = "";
  server.hash = "";
  return server.toString().replace(/\/$/, "");
}

function createClientKey() {
  const keyId = randomBytes(8).toString("hex");
  const key = `uhm_${keyId}_${randomBytes(32).toString("hex")}`;
  return { keyId, key, keyHash: createHash("sha256").update(key).digest("hex") };
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.ultimate-hermes-${process.pid}.tmp`;
  await writeFile(tempPath, content, { mode: 0o600 });
  await chmod(tempPath, 0o600);
  await rename(tempPath, filePath);
  await chmod(filePath, 0o600);
}

async function snapshot(filePath) {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function codexConfig(current, server, key) {
  const header = "[mcp_servers.ultimate-hermes]";
  const replacement = `${header}\nurl = ${JSON.stringify(`${server}/mcp`)}\nhttp_headers = { Authorization = ${JSON.stringify(`Bearer ${key}`)} }`;
  const lines = current.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${replacement}\n`;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[\[?.+\]\]?\s*$/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...replacement.split("\n"), ...lines.slice(end)].join("\n").replace(/\n*$/, "\n");
}

function claudeConfig(current, server, key) {
  const config = current.trim() ? JSON.parse(current) : {};
  config.mcpServers ??= {};
  config.mcpServers[SERVER_NAME] = {
    type: "http",
    url: `${server}/mcp`,
    headers: { Authorization: `Bearer ${key}` }
  };
  return `${JSON.stringify(config, null, 2)}\n`;
}

async function exchange(server, enrollment, credential) {
  const response = await fetch(`${server}/api/v1/enrollments/exchange`, {
    method: "POST",
    headers: { Authorization: `Bearer ${enrollment}`, "Content-Type": "application/json" },
    body: JSON.stringify({ keyId: credential.keyId, keyHash: credential.keyHash })
  });
  if (!response.ok) throw new Error(`Enrollment failed (${response.status}). The code may be expired or already used.`);
  return response.json();
}

async function verify(server, key, agent) {
  const response = await fetch(`${server}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: `ultimate-hermes-installer-${agent}`, version: "1.0.0" }
      }
    })
  });
  if (!response.ok) throw new Error(`The key was registered, but MCP verification failed (${response.status}).`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const agent = args.agent;
  if (!args.server || !args.enrollment || !args.name || !["codex", "claude"].includes(agent)) {
    throw new Error("Required: --server URL --enrollment CODE --agent codex|claude --name DEVICE");
  }
  if (args.name.length > 100) throw new Error("Device name must be at most 100 characters.");
  if (!/^uhe_[a-f0-9]{16}_[a-f0-9]{64}$/.test(args.enrollment)) throw new Error("Invalid enrollment code format.");
  const server = normalizeServer(args.server);
  const health = await fetch(`${server}/api/v1/health`);
  if (!health.ok) throw new Error(`Server health check failed (${health.status}).`);

  const home = process.env.HOME || os.homedir();
  const configPath = agent === "codex" ? path.join(home, ".codex", "config.toml") : path.join(home, ".claude.json");
  const before = await snapshot(configPath);
  const current = before?.toString("utf8") ?? "";
  const credential = createClientKey();
  const updated = agent === "codex" ? codexConfig(current, server, credential.key) : claudeConfig(current, server, credential.key);
  await atomicWrite(configPath, updated);

  let result;
  try {
    result = await exchange(server, args.enrollment, credential);
  } catch (error) {
    if (before) await atomicWrite(configPath, before);
    else await unlink(configPath).catch((unlinkError) => {
      if (unlinkError?.code !== "ENOENT") throw unlinkError;
    });
    throw error;
  }
  await verify(server, credential.key, agent);
  console.log(`Ultimate Hermes configured for ${agent} on ${args.name}.`);
  console.log(`Client: ${result.client?.label ?? `${args.name}-${agent}`} (${credential.keyId}); config: ${configPath}`);
}

main().catch((error) => {
  console.error(`Ultimate Hermes installation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
