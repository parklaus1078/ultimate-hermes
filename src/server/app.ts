import express from "express";
import { z, ZodError } from "zod";
import { loadConfig, type AppConfig } from "../config/env.js";
import { ApprovalRepository } from "../db/approvals.js";
import { EventRepository } from "../db/events.js";
import { query } from "../db/client.js";
import { McpClientRepository } from "../db/mcp-clients.js";
import { handleMcpHttpRequest } from "../mcp/server.js";
import {
  requireAllowedRemoteOrigin,
  createAuthAttemptGuard,
  createRemoteAuth,
  requireLifeArchiveAdmin,
  requireMcpToolScope,
  requireRemoteWrites,
  requireScopes
} from "../remote/auth.js";
import {
  LIFE_ARCHIVE_SCOPES,
  LIFE_ARCHIVE_WRITE_SCOPE,
  type AccessTokenVerifier
} from "../remote/auth0.js";
import { auditAuthenticatedRequest } from "../remote/request-audit.js";
import { AuthFailureRateLimiter } from "../remote/auth-rate-limit.js";
import { captureEvent, contextPack, recallEvents, recentEvents, timeline } from "../remote/tools.js";

const version = "0.4.0";

type CreateAppOptions = {
  verifyAccessToken?: AccessTokenVerifier;
};

function isPublicMcpDiscovery(body: unknown): boolean {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const request = body as { jsonrpc?: unknown; method?: unknown };
  return request.jsonrpc === "2.0" &&
    (request.method === "initialize" ||
      request.method === "notifications/initialized" ||
      request.method === "tools/list");
}

export function buildProtectedResourceMetadata(
  config: Pick<AppConfig, "auth0Audience" | "auth0Issuer" | "publicBaseUrl">
) {
  if (!config.auth0Audience || !config.auth0Issuer) return null;
  return {
    resource: config.auth0Audience,
    authorization_servers: [config.auth0Issuer],
    scopes_supported: [...LIFE_ARCHIVE_SCOPES],
    resource_name: "Life Archive MCP"
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function buildInstallCommand(input: {
  baseUrl: string;
  enrollmentToken: string;
  deviceName: string;
  agentType: "codex" | "claude" | "hermes";
}): string {
  const common = `--server ${shellQuote(input.baseUrl)} --enrollment ${shellQuote(input.enrollmentToken)} --agent ${shellQuote(input.agentType)} --name ${shellQuote(input.deviceName)}`;
  if (input.agentType === "hermes") {
    return `curl -fsSL ${shellQuote(`${input.baseUrl}/api/v1/installers/mcp-client.py`)} | "$HOME/.hermes/hermes-agent/venv/bin/python" - ${common}`;
  }
  return `curl -fsSL ${shellQuote(`${input.baseUrl}/api/v1/installers/mcp-client.mjs`)} | node --input-type=module - -- ${common}`;
}

export function createApp(options: CreateAppOptions = {}) {
  const config = loadConfig();
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops > 0 ? config.trustProxyHops : false);
  app.use(express.json({ limit: "2mb" }));

  const authRateLimiter = new AuthFailureRateLimiter({
    enabled: config.authRateLimitEnabled,
    maxFailures: config.authRateLimitMaxFailures,
    windowMs: config.authRateLimitWindowMs,
    blockMs: config.authRateLimitBlockMs,
    maxEntries: config.authRateLimitMaxEntries
  });
  const authAttemptGuard = createAuthAttemptGuard(authRateLimiter);
  const remoteAuth = createRemoteAuth(authRateLimiter, {
    config,
    verifyAccessToken: options.verifyAccessToken
  });
  const remoteGuards = [
    requireAllowedRemoteOrigin,
    authAttemptGuard,
    remoteAuth,
    auditAuthenticatedRequest
  ] as const;
  const adminGuards = [...remoteGuards, requireLifeArchiveAdmin] as const;
  const writeScopeGuard = requireScopes([LIFE_ARCHIVE_WRITE_SCOPE]);

  const sendProtectedResourceMetadata: express.RequestHandler = (_req, res) => {
    const metadata = buildProtectedResourceMetadata(config);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=300");
    if (!metadata) {
      res.status(503).json({ ok: false, error: "Auth0 OAuth is not configured." });
      return;
    }
    res.json(metadata);
  };

  app.get("/.well-known/oauth-protected-resource", sendProtectedResourceMetadata);
  app.get("/.well-known/oauth-protected-resource/mcp", sendProtectedResourceMetadata);

  app.get("/", (_req, res) => {
    res.json({
      service: "life-archive",
      version,
      mcp: "/mcp",
      oauthProtectedResource: "/.well-known/oauth-protected-resource",
      health: "/api/v1/health",
      readiness: "/api/v1/ready"
    });
  });

  app.options("/mcp", (_req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, DELETE, OPTIONS");
    res.status(204).send();
  });

  app.post("/mcp", requireAllowedRemoteOrigin, async (req, res, next) => {
    if (!isPublicMcpDiscovery(req.body)) {
      next();
      return;
    }
    try {
      await handleMcpHttpRequest(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp", authAttemptGuard, remoteAuth, auditAuthenticatedRequest, requireMcpToolScope, async (req, res, next) => {
    try {
      await handleMcpHttpRequest(req, res);
    } catch (error) {
      next(error);
    }
  });

  app.get("/mcp", ...remoteGuards, (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Standalone SSE streams are not supported. Use POST Streamable HTTP." }
    });
  });

  app.delete("/mcp", ...remoteGuards, (_req, res) => {
    res.setHeader("Allow", "POST");
    res.status(405).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "This server is stateless and has no session to delete." }
    });
  });

  app.get("/api/v1/health", (_req, res) => {
    res.json({ ok: true, service: "life-archive", version, uptimeSeconds: Math.floor(process.uptime()) });
  });

  app.get("/api/v1/ready", async (_req, res, next) => {
    try {
      const result = await query(
        `select to_regclass('public.life_events') is not null
                and to_regclass('public.mcp_clients') is not null as schema_ready`
      );
      if (!result.rows[0]?.schema_ready) {
        res.status(503).json({ ok: false, service: "life-archive", database: "schema-missing" });
        return;
      }
      res.json({ ok: true, service: "life-archive", database: "ready" });
    } catch (error) {
      next(error);
    }
  });

  app.all(
    [
      "/api/v1/installers/mcp-client.mjs",
      "/api/v1/installers/mcp-client.py",
      "/api/v1/admin/enrollments",
      "/api/v1/enrollments/exchange",
      "/api/v1/admin/clients",
      "/api/v1/admin/clients/:clientId/revoke"
    ],
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.status(410).json({
        ok: false,
        error: "MCP client keys and installers are retired. Connect through Auth0 OAuth instead."
      });
    }
  );

  app.get("/api/v1/admin/request-logs", ...adminGuards, async (req, res, next) => {
    try {
      const parsed = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit);
      res.json({ ok: true, logs: await new McpClientRepository().listRequestLogs(parsed) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/events/recent", ...remoteGuards, async (req, res, next) => {
    try {
      res.json(await recentEvents(req.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/recall", ...remoteGuards, async (req, res, next) => {
    try {
      res.json(await recallEvents(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/timeline", ...remoteGuards, async (req, res, next) => {
    try {
      res.json(await timeline(req.query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/events", ...remoteGuards, writeScopeGuard, requireRemoteWrites, async (req, res, next) => {
    try {
      res.json(await captureEvent(req.body));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/context-pack", ...remoteGuards, async (req, res, next) => {
    try {
      res.type("text/markdown").send(await contextPack(req.body));
    } catch (error) {
      next(error);
    }
  });

  if (config.enableLegacyRoutes) {
    app.get("/health", (_req, res) => res.redirect(308, "/api/v1/health"));
    app.get("/events/recent", ...remoteGuards, async (req, res, next) => {
      try {
        const limit = Number.parseInt(String(req.query.limit ?? "25"), 10);
        res.json(await new EventRepository().listRecent(limit));
      } catch (error) {
        next(error);
      }
    });
    app.get("/approvals", ...remoteGuards, async (_req, res, next) => {
      try {
        res.json(await new ApprovalRepository().listPending());
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: "error", method: req.method, path: req.path, error: message }));
    if (error instanceof ZodError) {
      res.status(400).json({ ok: false, error: "Invalid request.", issues: error.issues });
      return;
    }
    res.status(500).json({ ok: false, error: config.nodeEnv === "production" ? "Internal server error." : message });
  });

  return app;
}
