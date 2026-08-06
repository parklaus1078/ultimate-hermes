import express from "express";
import { loadConfig } from "../config/env.js";
import { ApprovalRepository } from "../db/approvals.js";
import { EventRepository } from "../db/events.js";
import { query } from "../db/client.js";
import { handleMcpHttpRequest } from "../mcp/server.js";
import { requireAllowedRemoteOrigin, requireRemoteAuth, requireRemoteWrites } from "../remote/auth.js";
import { captureEvent, contextPack, recallEvents, recentEvents, timeline } from "../remote/tools.js";

const version = "0.2.0";

export function createApp() {
  const config = loadConfig();
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "2mb" }));

  const remoteGuards = [requireAllowedRemoteOrigin, requireRemoteAuth] as const;

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
      const result = await query("select to_regclass('public.life_events') is not null as life_archive_ready");
      if (!result.rows[0]?.life_archive_ready) {
        res.status(503).json({ ok: false, service: "ultimate-hermes", database: "schema-missing" });
        return;
      }
      res.json({ ok: true, service: "ultimate-hermes", database: "ready" });
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
    res.status(500).json({ ok: false, error: config.nodeEnv === "production" ? "Internal server error." : message });
  });

  return app;
}
