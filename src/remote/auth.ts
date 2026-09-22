import type express from "express";
import { loadConfig, type AppConfig } from "../config/env.js";
import { AuthFailureRateLimiter } from "./auth-rate-limit.js";
import {
  AuthorizationError,
  createAuth0AccessTokenVerifier,
  hasAllScopes,
  LIFE_ARCHIVE_ADMIN_SCOPE,
  LIFE_ARCHIVE_READ_SCOPE,
  LIFE_ARCHIVE_SCOPES,
  LIFE_ARCHIVE_WRITE_SCOPE,
  type AccessTokenVerifier,
  type AuthenticatedClient
} from "./auth0.js";
import { boundedHeader, requestAddresses } from "./request-metadata.js";

export type { AuthenticatedClient } from "./auth0.js";

type RemoteAuthOptions = {
  config?: AppConfig;
  verifyAccessToken?: AccessTokenVerifier;
};

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function bearerToken(req: express.Request): string | null {
  const header = req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1]!.trim() : null;
}

export function oauthProtectedResourceMetadataUrl(config: Pick<AppConfig, "publicBaseUrl">): string {
  return new URL("/.well-known/oauth-protected-resource", config.publicBaseUrl).toString();
}

function authorizationChallenge(
  config: Pick<AppConfig, "publicBaseUrl">,
  scope: string,
  error?: "invalid_token" | "insufficient_scope",
  description?: string
): string {
  const attributes = [
    `resource_metadata="${oauthProtectedResourceMetadataUrl(config)}"`,
    `scope="${scope}"`
  ];
  if (error) attributes.push(`error="${error}"`);
  if (description) {
    const safeDescription = description.replace(/["\\\r\n]/g, " ").slice(0, 300);
    attributes.push(`error_description="${safeDescription}"`);
  }
  return `Bearer ${attributes.join(", ")}`;
}

export function requireAllowedRemoteOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const config = loadConfig();
  const hostname = req.hostname.toLowerCase();
  if (!config.allowedHosts.some((allowed) => allowed.toLowerCase() === hostname)) {
    logAuthorizationRejection(req, "host_not_allowed");
    res.status(403).json({ ok: false, error: "Host is not allowed." });
    return;
  }

  const origin = req.header("origin");
  if (!origin) {
    next();
    return;
  }

  if (!config.allowedOrigins.includes(origin)) {
    logAuthorizationRejection(req, "origin_not_allowed");
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

function logAuthorizationRejection(req: express.Request, reason: string, grantedScopeCount?: number): void {
  console.warn(JSON.stringify({
    level: "warn",
    event: "mcp_authorization_rejected",
    reason,
    method: req.method.slice(0, 16),
    path: req.path.slice(0, 300),
    sourceIp: requestAddresses(req).sourceIp ?? "unknown",
    userAgent: boundedHeader(req, "user-agent", 500),
    ...(grantedScopeCount === undefined ? {} : { grantedScopeCount })
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
  const config = loadConfig();
  logAuthFailure(req, "mcp_auth_rejected", decision.failures);
  res.setHeader(
    "WWW-Authenticate",
    authorizationChallenge(config, LIFE_ARCHIVE_READ_SCOPE, "invalid_token", message)
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(401).json({ ok: false, error: message });
}

function rejectInsufficientAuthorization(
  req: express.Request,
  res: express.Response,
  config: Pick<AppConfig, "publicBaseUrl">,
  requiredScopes: readonly string[],
  message: string,
  grantedScopeCount?: number
): void {
  const client = res.locals.hermesClient as AuthenticatedClient | undefined;
  logAuthorizationRejection(req, "insufficient_scope", grantedScopeCount ?? client?.scopes.length);
  res.setHeader(
    "WWW-Authenticate",
    authorizationChallenge(config, requiredScopes.join(" "), "insufficient_scope", message)
  );
  res.setHeader("Cache-Control", "no-store");
  res.status(403).json({ ok: false, error: message, requiredScopes });
}

export function createRemoteAuth(rateLimiter: AuthFailureRateLimiter, options: RemoteAuthOptions = {}) {
  const config = options.config ?? loadConfig();
  const verifyAccessToken = options.verifyAccessToken ?? (
    config.auth0Issuer && config.auth0Audience ? createAuth0AccessTokenVerifier(config) : null
  );

  return async function requireRemoteAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    if (!verifyAccessToken && config.nodeEnv !== "production" && isLoopbackHost(config.host)) {
      res.locals.hermesClient = {
        id: null,
        keyId: "local-development",
        label: "local-development",
        deviceName: "localhost",
        agentType: "local",
        canManageClients: true,
        authentication: "local-development",
        subject: "local-development",
        scopes: [...LIFE_ARCHIVE_SCOPES],
        permissions: [...LIFE_ARCHIVE_SCOPES]
      } satisfies AuthenticatedClient;
      next();
      return;
    }

    const token = bearerToken(req);
    if (!token || !verifyAccessToken) {
      rejectInvalidAuthentication(req, res, rateLimiter, "Auth0 login is required.");
      return;
    }

    try {
      const client = await verifyAccessToken(token);
      if (!hasAllScopes(client, [LIFE_ARCHIVE_READ_SCOPE])) {
        rejectInsufficientAuthorization(
          req,
          res,
          config,
          [LIFE_ARCHIVE_READ_SCOPE],
          "Life Archive read permission is required.",
          client.scopes.length
        );
        return;
      }
      res.locals.hermesClient = client;
      if (client.authInfo) {
        (req as express.Request & { auth?: typeof client.authInfo }).auth = client.authInfo;
      }
      next();
    } catch (error) {
      if (error instanceof AuthorizationError) {
        if (error.status === 403) {
          rejectInsufficientAuthorization(req, res, config, [LIFE_ARCHIVE_READ_SCOPE], error.message);
          return;
        }
        rejectInvalidAuthentication(req, res, rateLimiter, error.message);
        return;
      }
      next(error);
    }
  };
}

export function requireScopes(requiredScopes: readonly string[]) {
  return function requireOAuthScopes(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) {
    const config = loadConfig();
    const client = res.locals.hermesClient as AuthenticatedClient | undefined;
    if (!client || !hasAllScopes(client, requiredScopes)) {
      rejectInsufficientAuthorization(
        req,
        res,
        config,
        requiredScopes,
        `Missing required Auth0 permission: ${requiredScopes.join(", ")}.`
      );
      return;
    }
    next();
  };
}

export const requireLifeArchiveAdmin = requireScopes([LIFE_ARCHIVE_ADMIN_SCOPE]);

const writeMcpTools = new Set(["capture_event", "link_source"]);

function requestsWriteMcpTool(body: unknown): boolean {
  if (Array.isArray(body)) return body.some(requestsWriteMcpTool);
  if (!body || typeof body !== "object") return false;
  const message = body as { method?: unknown; params?: { name?: unknown } };
  return message.method === "tools/call" &&
    typeof message.params?.name === "string" &&
    writeMcpTools.has(message.params.name);
}

export function requireMcpToolScope(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (requestsWriteMcpTool(req.body)) {
    requireScopes([LIFE_ARCHIVE_WRITE_SCOPE])(req, res, next);
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
