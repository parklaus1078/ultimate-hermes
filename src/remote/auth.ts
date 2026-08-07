import { timingSafeEqual } from "node:crypto";
import type express from "express";
import { loadConfig, type AppConfig } from "../config/env.js";
import { McpClientRepository, type AgentType, type McpClient } from "../db/mcp-clients.js";
import { AuthFailureRateLimiter } from "./auth-rate-limit.js";
import { parseClientCredential, safeHashEqual } from "./client-credentials.js";
import { boundedHeader, requestAddresses } from "./request-metadata.js";

export type AuthenticatedClient = {
  id: string | null;
  keyId: string;
  label: string;
  deviceName: string;
  agentType: AgentType | "legacy" | "local";
  canManageClients: boolean;
  authentication: "client-key" | "legacy-token" | "local-development";
};

type ClientLookup = (keyId: string) => Promise<McpClient | null>;

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function bearerToken(req: express.Request): string | null {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function authenticatedClient(client: McpClient): AuthenticatedClient {
  return {
    id: client.id,
    keyId: client.keyId,
    label: client.label,
    deviceName: client.deviceName,
    agentType: client.agentType,
    canManageClients: client.canManageClients,
    authentication: "client-key"
  };
}

export async function authenticateToken(
  token: string | null,
  config: Pick<AppConfig, "apiToken" | "acceptLegacyApiToken">,
  findClient: ClientLookup
): Promise<AuthenticatedClient | null> {
  if (
    token &&
    config.acceptLegacyApiToken &&
    config.apiToken &&
    safeTokenEqual(token, config.apiToken)
  ) {
    return {
      id: null,
      keyId: "legacy-bootstrap",
      label: "legacy-bootstrap",
      deviceName: "legacy-shared-token",
      agentType: "legacy",
      canManageClients: true,
      authentication: "legacy-token"
    };
  }

  if (!token) return null;
  const parsed = parseClientCredential(token);
  if (!parsed) return null;
  const client = await findClient(parsed.keyId);
  if (!client || !safeHashEqual(parsed.hash, client.keyHash)) return null;
  return authenticatedClient(client);
}

export function requireAllowedRemoteOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const config = loadConfig();
  const hostname = req.hostname.toLowerCase();
  if (!config.allowedHosts.some((allowed) => allowed.toLowerCase() === hostname)) {
    res.status(403).json({ ok: false, error: "Host is not allowed." });
    return;
  }

  const origin = req.header("origin");
  if (!origin) {
    next();
    return;
  }

  if (!config.allowedOrigins.includes(origin)) {
    res.status(403).json({ ok: false, error: "Origin is not allowed." });
    return;
  }

  next();
}

function sendRateLimited(res: express.Response, retryAfterSeconds: number): void {
  res.setHeader("Retry-After", String(retryAfterSeconds));
  res.setHeader("Cache-Control", "no-store");
  res.status(429).json({ ok: false, error: "Too many failed authentication attempts. Retry later." });
}

function logAuthFailure(req: express.Request, event: "mcp_auth_rejected" | "mcp_auth_rate_limited", failures: number): void {
  console.warn(JSON.stringify({
    level: "warn",
    event,
    method: req.method.slice(0, 16),
    path: req.path.slice(0, 300),
    sourceIp: requestAddresses(req).sourceIp ?? "unknown",
    failures,
    userAgent: boundedHeader(req, "user-agent", 500)
  }));
}

export function createAuthAttemptGuard(rateLimiter: AuthFailureRateLimiter) {
  return function requireAuthAttemptAllowed(req: express.Request, res: express.Response, next: express.NextFunction) {
    const decision = rateLimiter.check(requestAddresses(req).sourceIp);
    if (!decision.blocked) {
      next();
      return;
    }
    logAuthFailure(req, "mcp_auth_rate_limited", decision.failures);
    sendRateLimited(res, decision.retryAfterSeconds);
  };
}

export function rejectInvalidAuthentication(
  req: express.Request,
  res: express.Response,
  rateLimiter: AuthFailureRateLimiter,
  message: string
): void {
  const decision = rateLimiter.recordFailure(requestAddresses(req).sourceIp);
  if (decision.blocked) {
    logAuthFailure(req, "mcp_auth_rate_limited", decision.failures);
    sendRateLimited(res, decision.retryAfterSeconds);
    return;
  }
  logAuthFailure(req, "mcp_auth_rejected", decision.failures);
  res.setHeader("WWW-Authenticate", "Bearer");
  res.setHeader("Cache-Control", "no-store");
  res.status(401).json({ ok: false, error: message });
}

export function createRemoteAuth(rateLimiter: AuthFailureRateLimiter) {
  return async function requireRemoteAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const config = loadConfig();
    const repository = new McpClientRepository();

    if (!config.apiToken && config.nodeEnv !== "production" && isLoopbackHost(config.host)) {
      res.locals.hermesClient = {
        id: null,
        keyId: "local-development",
        label: "local-development",
        deviceName: "localhost",
        agentType: "local",
        canManageClients: true,
        authentication: "local-development"
      } satisfies AuthenticatedClient;
      next();
      return;
    }

    try {
      const client = await authenticateToken(
        bearerToken(req),
        config,
        (keyId) => repository.findActiveByKeyId(keyId)
      );
      if (!client) {
        rejectInvalidAuthentication(req, res, rateLimiter, "Missing or invalid bearer token.");
        return;
      }
      res.locals.hermesClient = client;
      if (client.id) {
        repository.touch(client.id).catch((error: unknown) => {
          console.error(JSON.stringify({ level: "error", event: "mcp_client_touch_failed", error: String(error) }));
        });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireClientManager(_req: express.Request, res: express.Response, next: express.NextFunction) {
  const client = res.locals.hermesClient as AuthenticatedClient | undefined;
  if (!client?.canManageClients) {
    res.status(403).json({ ok: false, error: "This client cannot manage MCP client keys." });
    return;
  }
  next();
}

export function requireRemoteWrites(_req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!loadConfig().allowRemoteWrites) {
    res.status(403).json({
      ok: false,
      error: "Remote writes are disabled. Set HERMES_ALLOW_REMOTE_WRITES=true to enable append-only capture tools."
    });
    return;
  }
  next();
}
