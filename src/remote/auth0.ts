import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey
} from "jose";
import type { AppConfig } from "../config/env.js";

export const LIFE_ARCHIVE_READ_SCOPE = "memory:read";
export const LIFE_ARCHIVE_WRITE_SCOPE = "memory:write";
export const LIFE_ARCHIVE_ADMIN_SCOPE = "memory:admin";
export const LIFE_ARCHIVE_OFFLINE_SCOPE = "offline_access";
export const LIFE_ARCHIVE_SCOPES = [
  LIFE_ARCHIVE_READ_SCOPE,
  LIFE_ARCHIVE_WRITE_SCOPE,
  LIFE_ARCHIVE_ADMIN_SCOPE
] as const;

export type Auth0Config = Pick<
  AppConfig,
  | "auth0Issuer"
  | "auth0Audience"
  | "auth0AllowedSubjects"
  | "auth0ClockToleranceSeconds"
  | "auth0MaxAccessTokenLifetimeSeconds"
  | "auth0SessionStartedAtClaim"
  | "auth0MaxSessionAgeSeconds"
>;

export type AuthenticatedClient = {
  id: null;
  keyId: string;
  label: string;
  deviceName: string;
  agentType: "other" | "local";
  canManageClients: boolean;
  authentication: "auth0-oauth" | "local-development";
  subject: string;
  scopes: string[];
  permissions: string[];
  authInfo?: AuthInfo;
};

export type AccessTokenVerifier = (token: string) => Promise<AuthenticatedClient>;

export class AuthorizationError extends Error {
  constructor(
    message: string,
    public readonly status: 401 | 403 = 401,
    public readonly oauthError: "invalid_token" | "insufficient_scope" = "invalid_token"
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function extractTokenScopes(payload: JWTPayload): string[] {
  const claims = payload as Record<string, unknown>;
  return [...new Set([
    ...stringValues(payload.scope),
    ...stringValues(claims.scp)
  ])];
}

export function extractTokenPermissions(payload: JWTPayload): string[] {
  return [...new Set(stringValues((payload as Record<string, unknown>).permissions))];
}

export function hasAllScopes(client: Pick<AuthenticatedClient, "scopes">, required: readonly string[]): boolean {
  return required.every((scope) => client.scopes.includes(scope));
}

function clientId(payload: JWTPayload): string {
  const claims = payload as Record<string, unknown>;
  if (typeof payload.azp === "string" && payload.azp) return payload.azp;
  if (typeof claims.client_id === "string" && claims.client_id) return claims.client_id;
  return "unknown-oauth-client";
}

function principalLabel(payload: JWTPayload, subject: string): string {
  const claims = payload as Record<string, unknown>;
  for (const value of [claims.email, claims.name, claims.preferred_username]) {
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
  }
  return subject.slice(0, 200);
}

function requiredAuth0Config(config: Auth0Config): {
  issuer: string;
  audience: string;
} {
  if (!config.auth0Issuer || !config.auth0Audience) {
    throw new Error("Auth0 is not configured. Set LIFE_ARCHIVE_AUTH0_ISSUER and LIFE_ARCHIVE_AUTH0_AUDIENCE.");
  }
  return {
    issuer: config.auth0Issuer,
    audience: config.auth0Audience
  };
}

function numericDateClaim(payload: JWTPayload, claim: string): number | null {
  const value = (payload as Record<string, unknown>)[claim];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function verifyAuth0AccessToken(
  token: string,
  config: Auth0Config,
  key: JWTVerifyGetKey
): Promise<AuthenticatedClient> {
  if (!token) throw new AuthorizationError("Missing bearer token.");
  const { issuer, audience } = requiredAuth0Config(config);

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      algorithms: ["RS256"],
      issuer,
      audience,
      clockTolerance: config.auth0ClockToleranceSeconds
    }));
  } catch (error) {
    console.warn(JSON.stringify({
      level: "warn",
      event: "auth0_jwt_verify_failed",
      reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
    }));
    throw new AuthorizationError("Invalid or expired Auth0 access token.");
  }

  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new AuthorizationError("Auth0 access token is missing the subject claim.");
  }
  if (typeof payload.iat !== "number" || typeof payload.exp !== "number") {
    throw new AuthorizationError("Auth0 access token is missing iat or exp.");
  }
  if (payload.exp - payload.iat > config.auth0MaxAccessTokenLifetimeSeconds) {
    throw new AuthorizationError("Auth0 access token lifetime exceeds the server policy.");
  }
  let sessionStartedAt: number | null = null;
  if (config.auth0SessionStartedAtClaim) {
    sessionStartedAt = numericDateClaim(payload, config.auth0SessionStartedAtClaim);
    if (sessionStartedAt === null) {
      throw new AuthorizationError(
        "Auth0 access token is missing the configured Life Archive session start claim. Reconnect the MCP server."
      );
    }
    const now = Math.floor(Date.now() / 1_000);
    if (sessionStartedAt > now + config.auth0ClockToleranceSeconds) {
      throw new AuthorizationError("Auth0 session start claim is in the future.");
    }
    if (now - sessionStartedAt >= config.auth0MaxSessionAgeSeconds) {
      throw new AuthorizationError("Life Archive requires a fresh Auth0 login every 180 days.");
    }
  }
  if (
    config.auth0AllowedSubjects.length > 0 &&
    !config.auth0AllowedSubjects.includes(payload.sub)
  ) {
    throw new AuthorizationError(
      "This Auth0 user is not allowed to access Life Archive.",
      403,
      "insufficient_scope"
    );
  }

  const scopes = extractTokenScopes(payload);
  const permissions = extractTokenPermissions(payload);
  const oauthClientId = clientId(payload);
  const authInfo: AuthInfo = {
    token,
    clientId: oauthClientId,
    scopes,
    expiresAt: payload.exp,
    resource: new URL(audience),
    extra: {
      subject: payload.sub,
      issuer: payload.iss,
      sessionStartedAt
    }
  };

  return {
    id: null,
    keyId: `auth0:${payload.sub}`.slice(0, 200),
    label: principalLabel(payload, payload.sub),
    deviceName: oauthClientId.slice(0, 200),
    agentType: "other",
    canManageClients: scopes.includes(LIFE_ARCHIVE_ADMIN_SCOPE),
    authentication: "auth0-oauth",
    subject: payload.sub,
    scopes,
    permissions,
    authInfo
  };
}

export function createAuth0AccessTokenVerifier(config: Auth0Config): AccessTokenVerifier {
  const { issuer } = requiredAuth0Config(config);
  const jwks = createRemoteJWKSet(new URL(".well-known/jwks.json", issuer));
  return (token) => verifyAuth0AccessToken(token, config, jwks);
}
