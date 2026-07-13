import type express from "express";
import { loadConfig } from "../config/env.js";

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function bearerToken(req: express.Request): string | null {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

export function requireRemoteAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const config = loadConfig();

  // Localhost-only development remains frictionless. As soon as the server is
  // bound to a LAN/Tailscale address, require an explicit API token so agents
  // cannot accidentally expose the memory layer to the network.
  if (!isLoopbackHost(config.host) && !config.apiToken) {
    res.status(503).json({
      ok: false,
      error: "Remote Ultimate Hermes API is disabled because HERMES_API_TOKEN is not set. Set a token before binding HERMES_HOST to a Tailscale/LAN address."
    });
    return;
  }

  if (!config.apiToken) {
    next();
    return;
  }

  if (bearerToken(req) !== config.apiToken) {
    res.status(401).json({ ok: false, error: "Missing or invalid bearer token." });
    return;
  }

  next();
}
