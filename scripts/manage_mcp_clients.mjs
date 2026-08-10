#!/usr/bin/env node
import { constants, readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const command = args.shift();

function option(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function flag(name) {
  return args.includes(`--${name}`);
}

const agentTypes = ["codex", "claude", "hermes"];
const serverArgumentProvided = args.includes("--server");

function normalizeServer(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid Ultimate Hermes server URL: ${value || "(empty)"}`);
  }
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error("The Ultimate Hermes server must use HTTPS (HTTP is allowed only for localhost).");
  }
  parsed.pathname = parsed.pathname.replace(/\/mcp\/?$/, "").replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

const server = normalizeServer(
  option("server", process.env.ULTIMATE_HERMES_URL || "https://ultimate-hermes-mcp.onrender.com") || ""
);

class HttpError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function isRejectedManagerCredential(error) {
  return error instanceof HttpError && (
    error.status === 401 ||
    (error.status === 403 && error.message === "This client cannot manage MCP client keys.")
  );
}

function readOptional(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function tomlSection(config, header) {
  const lines = config.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && !/^\s*\[\[?.+\]\]?\s*$/.test(lines[end])) end += 1;
  return lines.slice(start + 1, end).join("\n");
}

function configuredServer(agent, configPath, value) {
  if (!value) {
    throw new Error(`${agent} has an Ultimate Hermes key but no MCP URL in ${configPath}.`);
  }
  try {
    return normalizeServer(value);
  } catch (error) {
    throw new Error(`${agent} has an invalid Ultimate Hermes MCP URL in ${configPath}: ${error.message}`);
  }
}

function yamlUltimateHermesUrl(config) {
  const lines = config.split(/\r?\n/);
  let mcpIndent = null;
  let serverIndent = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (mcpIndent === null) {
      if (/^mcp_servers\s*:\s*$/.test(trimmed)) mcpIndent = indent;
      continue;
    }
    if (serverIndent === null) {
      if (indent <= mcpIndent) break;
      if (/^["']?ultimate-hermes["']?\s*:\s*$/.test(trimmed)) serverIndent = indent;
      continue;
    }
    if (indent <= serverIndent) break;
    const match = trimmed.match(/^url\s*:\s*(.+?)\s*$/);
    if (!match) continue;
    const value = match[1];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      return value.slice(1, -1);
    }
    return value.split(/\s+#/, 1)[0].trim();
  }
  return null;
}

function discoverAgentCredential(agent) {
  const home = process.env.HOME || os.homedir();
  if (agent === "codex") {
    const configPath = path.join(home, ".codex", "config.toml");
    const config = readOptional(configPath);
    const section = tomlSection(config, "[mcp_servers.ultimate-hermes]");
    const headerToken = section.match(/Authorization\s*=\s*"Bearer\s+([^"\r\n]+)"/)?.[1];
    const envName = section.match(/bearer_token_env_var\s*=\s*"([^"\r\n]+)"/)?.[1];
    const token = headerToken || (envName ? process.env[envName]?.trim() || null : null);
    if (!token) return null;
    const url = section.match(/^\s*url\s*=\s*["']([^"'\r\n]+)["']/m)?.[1];
    return { token, server: configuredServer(agent, configPath, url) };
  }
  if (agent === "claude") {
    const configPath = path.join(home, ".claude.json");
    const current = readOptional(configPath);
    if (!current.trim()) return null;
    let config;
    try {
      config = JSON.parse(current);
    } catch (error) {
      throw new Error(`Cannot parse ${configPath}: ${error.message}`);
    }
    const entry = config.mcpServers?.["ultimate-hermes"];
    const token = entry?.headers?.Authorization?.replace(/^Bearer\s+/i, "") || null;
    if (!token) return null;
    return { token, server: configuredServer(agent, configPath, entry.url) };
  }
  if (agent === "hermes") {
    const hermesHome = process.env.HERMES_HOME || path.join(home, ".hermes");
    const envPath = path.join(hermesHome, ".env");
    const token = readOptional(envPath).match(/^MCP_ULTIMATE_HERMES_API_KEY=(.+)$/m)?.[1]?.trim() || null;
    if (!token) return null;
    const configPath = path.join(hermesHome, "config.yaml");
    return {
      token,
      server: configuredServer(agent, configPath, yamlUltimateHermesUrl(readOptional(configPath)))
    };
  }
  return null;
}

function addCredential(candidates, seen, source, token) {
  const value = token?.trim();
  if (!value || seen.has(value)) return;
  seen.add(value);
  candidates.push({ source, token: value });
}

function addAgentCredential(candidates, errors, seen, agent, explicit) {
  try {
    const credential = discoverAgentCredential(agent);
    if (!credential) return;
    if (credential.server !== server) {
      if (explicit) {
        throw new Error(
          `${agent} is configured for ${credential.server}, so its key will not be sent to ${server}.`
        );
      }
      return;
    }
    addCredential(candidates, seen, `${agent} config`, credential.token);
  } catch (error) {
    if (explicit) throw error;
    errors.push(error);
  }
}

function credentialCandidates(authAgent) {
  const candidates = [];
  const errors = [];
  const seen = new Set();
  addCredential(candidates, seen, "ULTIMATE_HERMES_ADMIN_TOKEN", process.env.ULTIMATE_HERMES_ADMIN_TOKEN);

  if (authAgent) {
    if (!agentTypes.includes(authAgent)) {
      throw new Error("--auth-agent must be codex, claude, or hermes.");
    }
    addAgentCredential(candidates, errors, seen, authAgent, true);
  } else {
    for (const agent of agentTypes) {
      addAgentCredential(candidates, errors, seen, agent, false);
    }
    if (!serverArgumentProvided) {
      addCredential(candidates, seen, "MCP_ULTIMATE_HERMES_API_KEY", process.env.MCP_ULTIMATE_HERMES_API_KEY);
      addCredential(candidates, seen, "ULTIMATE_HERMES_API_TOKEN", process.env.ULTIMATE_HERMES_API_TOKEN);
    }
  }
  return { candidates, errors };
}

async function promptSecret() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "No working manager key was found. Run this command in an interactive terminal, " +
      "or set ULTIMATE_HERMES_ADMIN_TOKEN for this command only."
    );
  }

  console.log("No installed manager key was found.");
  console.log(`Paste the admin token for ${server}.`);
  console.log("The value is hidden and is not saved.");
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const reader = createInterface({ input: process.stdin, output: muted, terminal: true });
  process.stdout.write("Admin token: ");
  try {
    const value = (await reader.question("")).trim();
    process.stdout.write("\n");
    if (!value) throw new Error("No admin token was entered.");
    return value;
  } finally {
    reader.close();
  }
}

async function serverVersion() {
  try {
    const response = await fetch(`${server}/`);
    if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) return null;
    const result = await response.json();
    return typeof result.version === "string" ? result.version : null;
  } catch {
    return null;
  }
}

async function call(path, token, init = {}) {
  const response = await fetch(`${server}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers }
  });
  const contentType = response.headers.get("content-type") || "unknown content type";
  const text = await response.text();
  let result = null;
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Ultimate Hermes returned malformed JSON for ${path} (HTTP ${response.status}).`);
    }
  }
  if (response.status === 404 && !result) {
    const version = await serverVersion();
    const versionText = version ? ` It is running Ultimate Hermes ${version}.` : "";
    throw new HttpError(
      `Server ${server} does not provide ${path} (HTTP 404, ${contentType}).${versionText} ` +
      "Apply 0006_mcp_client_auth.sql and deploy Ultimate Hermes 0.3.0 before using the clients command.",
      response.status
    );
  }
  if (!response.ok) {
    const serverError = result && typeof result === "object" && typeof result.error === "string"
      ? result.error
      : null;
    throw new HttpError(
      serverError || `Ultimate Hermes request ${path} failed (HTTP ${response.status}, ${contentType}).`,
      response.status
    );
  }
  if (!result) {
    throw new Error(`Ultimate Hermes returned ${contentType} instead of JSON for ${path} (HTTP ${response.status}).`);
  }
  return result;
}

async function resolveManager(authAgent) {
  const { candidates, errors } = credentialCandidates(authAgent);
  for (const candidate of candidates) {
    try {
      const result = await call("/api/v1/admin/clients", candidate.token);
      return { ...candidate, clients: result.clients };
    } catch (error) {
      if (!isRejectedManagerCredential(error)) throw error;
    }
  }

  if (errors.length > 0) throw errors[0];
  const token = await promptSecret();
  const result = await call("/api/v1/admin/clients", token);
  return { source: "hidden prompt", token, clients: result.clients };
}

async function callWithManager(pathname, init = {}) {
  const { candidates, errors } = credentialCandidates(option("auth-agent"));
  for (const candidate of candidates) {
    try {
      return await call(pathname, candidate.token, init);
    } catch (error) {
      if (!isRejectedManagerCredential(error)) throw error;
    }
  }
  if (errors.length > 0) throw errors[0];
  return call(pathname, await promptSecret(), init);
}

function positionalAgent() {
  const candidate = args[0]?.startsWith("--") ? null : args[0];
  return option("agent", candidate);
}

function enrollmentBody(deviceName, agentType, canManageClients, grantIfNoManager = false) {
  return JSON.stringify({
    deviceName,
    agentType,
    label: option("label") || undefined,
    expiresInMinutes: Number(option("expires", "10")),
    canManageClients,
    grantIfNoManager
  });
}

async function createSimpleEnrollment(agentType, deviceName, grantIfNoManager) {
  const manager = await resolveManager(option("auth-agent"));
  const hasActiveManager = manager.clients.some(
    (client) => client.status === "active" && client.canManageClients
  );
  const result = await call("/api/v1/admin/enrollments", manager.token, {
    method: "POST",
    body: enrollmentBody(deviceName, agentType, flag("admin"), grantIfNoManager)
  });
  if (
    grantIfNoManager &&
    result.enrollment?.canManageClients === undefined &&
    !hasActiveManager &&
    !flag("admin")
  ) {
    throw new Error(
      "The server is too old to grant the first manager atomically. Deploy the latest Ultimate Hermes server, then run connect again."
    );
  }
  return {
    result,
    canManageClients: Boolean(result.enrollment?.canManageClients ?? flag("admin"))
  };
}

async function verifyClient(token, agent) {
  const response = await fetch(`${server}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
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
        clientInfo: { name: `ultimate-hermes-connect-${agent}`, version: "1.0.0" }
      }
    })
  });
  if (response.ok) return true;
  if (response.status === 401) return false;
  let detail = "";
  try {
    const result = await response.json();
    if (typeof result?.error === "string") detail = `: ${result.error}`;
  } catch {
    // The status code is enough when a proxy returns a non-JSON body.
  }
  throw new Error(`Existing MCP connection check failed (${response.status}${detail}).`);
}

function enrollmentCode(result) {
  const structured = result.enrollment?.code;
  if (/^uhe_[a-f0-9]{16}_[a-f0-9]{64}$/.test(structured ?? "")) return structured;
  const fallback = result.enrollment?.installCommand?.match(/--enrollment\s+'(uhe_[a-f0-9]{16}_[a-f0-9]{64})'/)?.[1];
  if (fallback) return fallback;
  throw new Error("The server did not return a usable enrollment code. Deploy the latest Ultimate Hermes server.");
}

async function executable(filePath) {
  try {
    await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function run(commandName, commandArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn(commandName, commandArgs, { stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`The local installer exited with status ${code ?? "unknown"}.`));
    });
  });
}

async function installLocally(agentType, deviceName, code) {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const common = ["--server", server, "--enrollment", code, "--agent", agentType, "--name", deviceName];
  if (agentType !== "hermes") {
    await run(process.execPath, [path.join(scriptDirectory, "install_mcp_client.mjs"), ...common]);
    return;
  }

  const home = process.env.HOME || os.homedir();
  const hermesHome = process.env.HERMES_HOME || path.join(home, ".hermes");
  const hermesPython = path.join(hermesHome, "hermes-agent", "venv", "bin", "python");
  await run(await executable(hermesPython) ? hermesPython : "python3", [path.join(scriptDirectory, "install_mcp_client.py"), ...common]);
}

async function main() {
  if (command === "connect" || command === "pair") {
    const agentType = positionalAgent();
    const deviceName = option("device", command === "connect" ? os.hostname().slice(0, 100) : null);
    if (!agentTypes.includes(agentType) || !deviceName) {
      const usage = command === "connect"
        ? "npm run connect -- codex|claude|hermes [--device NAME] [--admin]"
        : "npm run pair -- codex|claude|hermes --device NAME [--admin]";
      throw new Error(`Usage: ${usage}`);
    }
    if (flag("replace")) {
      throw new Error("--replace is not supported because overwriting a config would leave the old key active. Revoke the old client first.");
    }

    if (command === "connect") {
      const current = discoverAgentCredential(agentType);
      if (current && current.server !== server) {
        throw new Error(
          `${agentType} is already configured for ${current.server}. Its key and config will not be overwritten for ${server}.`
        );
      }
      if (current && await verifyClient(current.token, agentType)) {
        if (flag("admin")) {
          throw new Error("This Agent is already connected. --admin is only valid while creating a new client.");
        }
        console.log(`Ultimate Hermes is already connected to ${agentType} on ${deviceName}.`);
        return;
      }
    }

    const { result, canManageClients } = await createSimpleEnrollment(
      agentType,
      deviceName,
      command === "connect"
    );
    if (command === "pair") {
      console.log(result.enrollment.installCommand);
      return;
    }

    await installLocally(agentType, deviceName, enrollmentCode(result));
    if (canManageClients) console.log("This client can add and revoke other Ultimate Hermes clients.");
  } else if (command === "create") {
    const deviceName = option("device");
    const agentType = option("agent");
    if (!deviceName || !agentTypes.includes(agentType)) {
      throw new Error("Usage: npm run clients -- create --device NAME --agent codex|claude|hermes [--label LABEL] [--admin]");
    }
    const result = await callWithManager("/api/v1/admin/enrollments", {
      method: "POST",
      body: enrollmentBody(deviceName, agentType, flag("admin"))
    });
    console.log(result.enrollment.installCommand);
  } else if (command === "list") {
    console.log(JSON.stringify((await callWithManager("/api/v1/admin/clients")).clients, null, 2));
  } else if (command === "logs") {
    console.log(JSON.stringify((await callWithManager(`/api/v1/admin/request-logs?limit=${encodeURIComponent(option("limit", "100"))}`)).logs, null, 2));
  } else if (command === "revoke") {
    const clientId = args.find((value) => !value.startsWith("--"));
    if (!clientId) throw new Error("Usage: npm run clients -- revoke CLIENT_ID");
    console.log(JSON.stringify((await callWithManager(`/api/v1/admin/clients/${encodeURIComponent(clientId)}/revoke`, { method: "POST" })).client, null, 2));
  } else {
    throw new Error("Usage: npm run connect -- AGENT | npm run pair -- AGENT --device NAME | npm run clients -- create|list|logs|revoke");
  }
}

main().catch((error) => {
  console.error(`Ultimate Hermes client management failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
