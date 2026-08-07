import { randomUUID } from "node:crypto";
import type express from "express";
import { McpClientRepository } from "../db/mcp-clients.js";
import type { AuthenticatedClient } from "./auth.js";
import { boundedHeader, requestAddresses } from "./request-metadata.js";

function requestOperation(req: express.Request): string | null {
  if (req.path !== "/mcp" || !req.body || Array.isArray(req.body) || typeof req.body !== "object") return null;
  const body = req.body as { method?: unknown; params?: { name?: unknown } };
  const method = typeof body.method === "string" ? body.method.slice(0, 120) : null;
  const tool = typeof body.params?.name === "string" ? body.params.name.slice(0, 120) : null;
  return tool && method === "tools/call" ? `${method}:${tool}` : method;
}

export function auditAuthenticatedRequest(req: express.Request, res: express.Response, next: express.NextFunction) {
  const client = res.locals.hermesClient as AuthenticatedClient | undefined;
  if (!client) {
    next();
    return;
  }

  const started = process.hrtime.bigint();
  const requestId = randomUUID();
  const addresses = requestAddresses(req);
  res.setHeader("X-Hermes-Request-Id", requestId);

  res.once("finish", () => {
    const durationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - started) / 1_000_000));
    const record = {
      requestId,
      clientId: client.id,
      clientLabel: client.label,
      deviceName: client.deviceName,
      agentType: client.agentType,
      method: req.method.slice(0, 16),
      path: req.path.slice(0, 300),
      operation: requestOperation(req),
      statusCode: res.statusCode,
      durationMs,
      ...addresses,
      userAgent: boundedHeader(req, "user-agent", 500),
      cfRay: boundedHeader(req, "cf-ray", 100)
    };
    console.log(JSON.stringify({ level: "info", event: "mcp_request", ...record }));
    if (process.env.NODE_ENV === "test") return;
    new McpClientRepository().recordRequest(record).catch((error: unknown) => {
      console.error(JSON.stringify({ level: "error", event: "mcp_request_audit_failed", requestId, error: String(error) }));
    });
  });

  next();
}
