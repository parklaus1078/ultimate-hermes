import express from "express";
import { loadConfig } from "../config/env.js";
import { ApprovalRepository } from "../db/approvals.js";
import { migrate } from "../db/client.js";
import { EventRepository } from "../db/events.js";
import { recordLinearWebhook } from "../adapters/linear/webhook.js";
import { GoogleOAuthClient } from "../adapters/google/oauth.js";
import { createSecretStore } from "../secrets/index.js";
import { RecallService } from "../search/recall.js";
import { LocalDeterministicEmbeddingProvider } from "../search/embedding-provider.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", async (_req, res, next) => {
    try {
      await migrate();
      res.json({ ok: true, service: "hermes" });
    } catch (error) {
      next(error);
    }
  });

  app.get("/events/recent", async (req, res, next) => {
    try {
      const limit = Number.parseInt(String(req.query.limit ?? "25"), 10);
      res.json(await new EventRepository().listRecent(limit));
    } catch (error) {
      next(error);
    }
  });

  app.get("/remember", async (req, res, next) => {
    try {
      const q = String(req.query.q ?? "");
      const limit = Number.parseInt(String(req.query.limit ?? "10"), 10);
      const recall = new RecallService(undefined, new LocalDeterministicEmbeddingProvider());
      res.json(await recall.remember({ queryText: q, limit }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/approvals", async (_req, res, next) => {
    try {
      res.json(await new ApprovalRepository().listPending());
    } catch (error) {
      next(error);
    }
  });

  app.post("/webhooks/linear", async (req, res, next) => {
    try {
      const eventId = await recordLinearWebhook(req.body as Record<string, unknown>);
      res.json({ ok: true, eventId });
    } catch (error) {
      next(error);
    }
  });

  app.get("/oauth/google/start", async (_req, res, next) => {
    try {
      const config = loadConfig();
      const url = await new GoogleOAuthClient(createSecretStore()).authUrl(`http://${config.host}:${config.port}/oauth/google/callback`);
      res.redirect(url);
    } catch (error) {
      next(error);
    }
  });

  app.get("/oauth/google/callback", async (req, res, next) => {
    try {
      const code = String(req.query.code ?? "");
      if (!code) throw new Error("Missing Google OAuth code");
      const config = loadConfig();
      await new GoogleOAuthClient(createSecretStore()).exchangeCode(code, `http://${config.host}:${config.port}/oauth/google/callback`);
      res.type("text/plain").send("Google OAuth connected. You can close this tab.");
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ ok: false, error: message });
  });

  return app;
}
