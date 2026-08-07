import express from "express";
import path from "node:path";
import { z, ZodError } from "zod";
import { loadConfig } from "../config/env.js";
import { ApprovalRepository } from "../db/approvals.js";
import { EventRepository } from "../db/events.js";
import { query } from "../db/client.js";
import { McpClientRepository } from "../db/mcp-clients.js";
import { handleMcpHttpRequest } from "../mcp/server.js";
import {
  requireAllowedRemoteOrigin,
  requireClientManager,
  requireRemoteAuth,
  requireRemoteWrites,
  type AuthenticatedClient
} from "../remote/auth.js";
import {
  createEnrollmentCredential,
  isSha256Hash,
  parseEnrollmentCredential
} from "../remote/client-credentials.js";
import { auditAuthenticatedRequest } from "../remote/request-audit.js";
import { captureEvent, contextPack, recallEvents, recentEvents, timeline } from "../remote/tools.js";

const version = "0.3.1";

const enrollmentSchema = z.object({
  deviceName: z.string().trim().min(1).max(100),
  agentType: z.enum(["codex", "claude", "hermes"]),
  label: z.string().trim().min(1).max(100).optional(),
  expiresInMinutes: z.number().int().min(5).max(60).default(10),
  canManageClients: z.boolean().default(false)
});

const exchangeSchema = z.object({
  keyId: z.string().regex(/^[a-f0-9]{16}$/),
  keyHash: z.string().refine(isSha256Hash, "keyHash must be a lowercase SHA-256 hex digest")
});

function bearerToken(req: express.Request): string | null {
  const match = (req.header("authorization") ?? "").match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
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

export function createApp() {
  const config = loadConfig();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  const remoteGuards = [requireAllowedRemoteOrigin, requireRemoteAuth, auditAuthenticatedRequest] as const;
  const adminGuards = [...remoteGuards, requireClientManager] as const;

  app.get("/", (_req, res) => {
    res.json({
      service: "ultimate-hermes",
      version,
      mcp: "/mcp",
      health: "/api/v1/health",
      readiness: "/api/v1/ready"
    });
  });

  app.post("/mcp", ...remoteGuards, async (req, res, next) => {
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
    res.json({ ok: true, service: "ultimate-hermes", version, uptimeSeconds: Math.floor(process.uptime()) });
  });

  app.get("/api/v1/ready", async (_req, res, next) => {
    try {
      const result = await query(
        `select to_regclass('public.life_events') is not null
                and to_regclass('public.mcp_clients') is not null as schema_ready`
      );
      if (!result.rows[0]?.schema_ready) {
        res.status(503).json({ ok: false, service: "ultimate-hermes", database: "schema-missing" });
        return;
      }
      res.json({ ok: true, service: "ultimate-hermes", database: "ready" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/installers/mcp-client.mjs", requireAllowedRemoteOrigin, (_req, res, next) => {
    res.type("text/javascript");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(process.cwd(), "scripts/install_mcp_client.mjs"), (error) => {
      if (error) next(error);
    });
  });

  app.get("/api/v1/installers/mcp-client.py", requireAllowedRemoteOrigin, (_req, res, next) => {
    res.type("text/x-python");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.resolve(process.cwd(), "scripts/install_mcp_client.py"), (error) => {
      if (error) next(error);
    });
  });

  app.post("/api/v1/admin/enrollments", ...adminGuards, async (req, res, next) => {
    try {
      const input = enrollmentSchema.parse(req.body);
      const actor = res.locals.hermesClient as AuthenticatedClient;
      const credential = createEnrollmentCredential();
      const expiresAt = new Date(Date.now() + input.expiresInMinutes * 60_000);
      const label = input.label ?? `${input.deviceName}-${input.agentType}`;
      await new McpClientRepository().createEnrollment({
        id: credential.id,
        tokenHash: credential.hash,
        label,
        deviceName: input.deviceName,
        agentType: input.agentType,
        canManageClients: input.canManageClients,
        expiresAt,
        createdByClientId: actor.id
      });
      res.status(201).json({
        ok: true,
        enrollment: {
          label,
          deviceName: input.deviceName,
          agentType: input.agentType,
          expiresAt,
          installCommand: buildInstallCommand({
            baseUrl: config.publicBaseUrl,
            enrollmentToken: credential.value,
            deviceName: input.deviceName,
            agentType: input.agentType
          })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/enrollments/exchange", requireAllowedRemoteOrigin, async (req, res, next) => {
    try {
      const enrollment = parseEnrollmentCredential(bearerToken(req) ?? "");
      const input = exchangeSchema.parse(req.body);
      if (!enrollment) {
        res.status(401).json({ ok: false, error: "Invalid or expired enrollment token." });
        return;
      }
      const client = await new McpClientRepository().exchangeEnrollment({
        enrollmentId: enrollment.enrollmentId,
        tokenHash: enrollment.hash,
        keyId: input.keyId,
        keyHash: input.keyHash
      });
      if (!client) {
        res.status(401).json({ ok: false, error: "Invalid or expired enrollment token." });
        return;
      }
      res.status(201).json({ ok: true, client });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/admin/clients", ...adminGuards, async (_req, res, next) => {
    try {
      res.json({ ok: true, clients: await new McpClientRepository().listClients() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/v1/admin/clients/:clientId/revoke", ...adminGuards, async (req, res, next) => {
    try {
      const actor = res.locals.hermesClient as AuthenticatedClient;
      const clientId = z.string().min(1).max(100).parse(req.params.clientId);
      if (actor.id === clientId) {
        res.status(409).json({ ok: false, error: "A client cannot revoke its own key." });
        return;
      }
      const client = await new McpClientRepository().revoke(clientId);
      if (!client) {
        res.status(404).json({ ok: false, error: "Active client not found." });
        return;
      }
      res.json({ ok: true, client });
    } catch (error) {
      next(error);
    }
  });

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

  app.post("/api/v1/events", ...remoteGuards, requireRemoteWrites, async (req, res, next) => {
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
