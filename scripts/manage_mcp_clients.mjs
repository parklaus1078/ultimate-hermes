#!/usr/bin/env node
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const command = args.shift();

function option(name, fallback = null) {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
}

function flag(name) {
  return args.includes(`--${name}`);
}

const server = (option("server", process.env.ULTIMATE_HERMES_URL || "https://ultimate-hermes-mcp.onrender.com") || "").replace(/\/$/, "");

function readOptional(filePath) {
  try {
    return readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function discoverAgentToken(agent) {
  const home = process.env.HOME || os.homedir();
  if (agent === "codex") {
    const config = readOptional(path.join(home, ".codex", "config.toml"));
    const section = config.match(/\[mcp_servers\.ultimate-hermes\]([\s\S]*?)(?=\n\s*\[\[?.+\]\]?\s*$|$)/m)?.[1] || "";
    return section.match(/Authorization\s*=\s*"Bearer\s+([^"\r\n]+)"/)?.[1] || null;
  }
  if (agent === "claude") {
    const config = JSON.parse(readOptional(path.join(home, ".claude.json")) || "{}");
    return config.mcpServers?.["ultimate-hermes"]?.headers?.Authorization?.replace(/^Bearer\s+/i, "") || null;
  }
  if (agent === "hermes") {
    const env = readOptional(path.join(process.env.HERMES_HOME || path.join(home, ".hermes"), ".env"));
    return env.match(/^MCP_ULTIMATE_HERMES_API_KEY=(.+)$/m)?.[1]?.trim() || null;
  }
  return null;
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
    throw new Error(
      `Server ${server} does not provide ${path} (HTTP 404, ${contentType}).${versionText} ` +
      "Apply 0006_mcp_client_auth.sql and deploy Ultimate Hermes 0.3.0 before using the clients command."
    );
  }
  if (!response.ok) {
    const serverError = result && typeof result === "object" && typeof result.error === "string"
      ? result.error
      : null;
    throw new Error(serverError || `Ultimate Hermes request ${path} failed (HTTP ${response.status}, ${contentType}).`);
  }
  if (!result) {
    throw new Error(`Ultimate Hermes returned ${contentType} instead of JSON for ${path} (HTTP ${response.status}).`);
  }
  return result;
}

async function main() {
  const authAgent = option("auth-agent");
  const token = process.env.ULTIMATE_HERMES_ADMIN_TOKEN ||
    process.env.MCP_ULTIMATE_HERMES_API_KEY ||
    process.env.ULTIMATE_HERMES_API_TOKEN ||
    discoverAgentToken(authAgent);
  if (!token) {
    throw new Error("Set ULTIMATE_HERMES_ADMIN_TOKEN or pass --auth-agent codex|claude|hermes for a manager client.");
  }

  if (command === "create") {
    const deviceName = option("device");
    const agentType = option("agent");
    if (!deviceName || !["codex", "claude", "hermes"].includes(agentType)) {
      throw new Error("Usage: npm run clients -- create --device NAME --agent codex|claude|hermes [--label LABEL] [--admin]");
    }
    const result = await call("/api/v1/admin/enrollments", token, {
      method: "POST",
      body: JSON.stringify({
        deviceName,
        agentType,
        label: option("label") || undefined,
        expiresInMinutes: Number(option("expires", "10")),
        canManageClients: flag("admin")
      })
    });
    console.log(result.enrollment.installCommand);
  } else if (command === "list") {
    console.log(JSON.stringify((await call("/api/v1/admin/clients", token)).clients, null, 2));
  } else if (command === "logs") {
    console.log(JSON.stringify((await call(`/api/v1/admin/request-logs?limit=${encodeURIComponent(option("limit", "100"))}`, token)).logs, null, 2));
  } else if (command === "revoke") {
    const clientId = args.find((value) => !value.startsWith("--"));
    if (!clientId) throw new Error("Usage: npm run clients -- revoke CLIENT_ID");
    console.log(JSON.stringify((await call(`/api/v1/admin/clients/${encodeURIComponent(clientId)}/revoke`, token, { method: "POST" })).client, null, 2));
  } else {
    throw new Error("Usage: npm run clients -- create|list|logs|revoke");
  }
}

main().catch((error) => {
  console.error(`Ultimate Hermes client management failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
