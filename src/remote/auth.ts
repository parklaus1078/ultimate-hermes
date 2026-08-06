import { timingSafeEqual } from "node:crypto";
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

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
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

export function requireRemoteAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const config = loadConfig();

  // Localhost-only development remains frictionless. As soon as the server is
  // bound to a LAN/Tailscale address, require an explicit API token so agents
  // cannot accidentally expose the memory layer to the network.
  if ((config.nodeEnv === "production" || !isLoopbackHost(config.host)) && !config.apiToken) {
    res.status(503).json({
      ok: false,
      error: "Remote Ultimate Hermes API is disabled because HERMES_API_TOKEN is not set."
    });
    return;
  }

  if (!config.apiToken) {
    next();
    return;
  }

  const token = bearerToken(req);
  if (!token || !safeTokenEqual(token, config.apiToken)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(401).json({ ok: false, error: "Missing or invalid bearer token." });
    return;
  }

  next();
}

export function requireRemoteWrites(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!loadConfig().allowRemoteWrites) {
    res.status(403).json({
      ok: false,
      error: "Remote writes are disabled. Set HERMES_ALLOW_REMOTE_WRITES=true to enable append-only capture tools."
    });
    return;
  }
  next();
}
