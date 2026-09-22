import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey
} from "jose";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  LIFE_ARCHIVE_READ_SCOPE,
  LIFE_ARCHIVE_OFFLINE_SCOPE,
  LIFE_ARCHIVE_WRITE_SCOPE,
  LIFE_ARCHIVE_ADMIN_SCOPE,
  extractTokenPermissions,
  extractTokenScopes,
  hasAllScopes,
  verifyAuth0AccessToken,
  type Auth0Config
} from "../../src/remote/auth0.js";

const issuer = "https://life-archive-test.us.auth0.com/";
const audience = "https://life-archive.example.com/mcp";
const subject = "auth0|life-archive-owner";

const config: Auth0Config = {
  auth0Issuer: issuer,
  auth0Audience: audience,
  auth0AllowedSubjects: [subject],
  auth0ClockToleranceSeconds: 5,
  auth0MaxAccessTokenLifetimeSeconds: 3_600,
  auth0SessionStartedAtClaim: `${audience}/session_started_at`,
  auth0MaxSessionAgeSeconds: 15_552_000
};

let privateKey: CryptoKey;
let untrustedPrivateKey: CryptoKey;
let keyResolver: JWTVerifyGetKey;

beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  privateKey = keys.privateKey;
  untrustedPrivateKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = await exportJWK(keys.publicKey);
  keyResolver = createLocalJWKSet({ keys: [{ ...jwk, kid: "life-archive-test-key", alg: "RS256" }] });
});

async function token(input: {
  tokenIssuer?: string;
  tokenAudience?: string;
  tokenSubject?: string | null;
  issuedAt?: number;
  expiresAt?: number;
  scope?: string;
  permissions?: string[];
  sessionStartedAt?: number | null;
  signingKey?: CryptoKey;
} = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1_000);
  const sessionStartedAt = input.sessionStartedAt === undefined ? now : input.sessionStartedAt;
  let signer = new SignJWT({
    scope: input.scope ?? `${LIFE_ARCHIVE_READ_SCOPE} ${LIFE_ARCHIVE_WRITE_SCOPE}`,
    permissions: input.permissions ?? [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE],
    ...(sessionStartedAt === null ? {} : { [`${audience}/session_started_at`]: sessionStartedAt })
  })
    .setProtectedHeader({ alg: "RS256", kid: "life-archive-test-key" })
    .setIssuer(input.tokenIssuer ?? issuer)
    .setAudience(input.tokenAudience ?? audience)
    .setIssuedAt(input.issuedAt ?? now)
    .setExpirationTime(input.expiresAt ?? now + 3_600);
  if (input.tokenSubject !== null) signer = signer.setSubject(input.tokenSubject ?? subject);
  return signer.sign(input.signingKey ?? privateKey);
}

describe("Auth0 MCP access token authentication", () => {
  it("accepts a valid RS256 token and maps the Auth0 principal", async () => {
    const result = await verifyAuth0AccessToken(await token(), config, keyResolver);
    expect(result).toMatchObject({
      subject,
      authentication: "auth0-oauth",
      scopes: expect.arrayContaining([LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE])
    });
    expect(result.authInfo).toMatchObject({ resource: new URL(audience), expiresAt: expect.any(Number) });
  });

  it("rejects tokens issued for another issuer or audience", async () => {
    await expect(
      verifyAuth0AccessToken(await token({ tokenIssuer: "https://attacker.example.com/" }), config, keyResolver)
    ).rejects.toThrow(/invalid or expired/i);
    await expect(
      verifyAuth0AccessToken(await token({ tokenAudience: "https://another-api.example.com" }), config, keyResolver)
    ).rejects.toThrow(/invalid or expired/i);
  });

  it("rejects an untrusted signature, a missing subject, and a retired static token", async () => {
    await expect(
      verifyAuth0AccessToken(await token({ signingKey: untrustedPrivateKey }), config, keyResolver)
    ).rejects.toThrow(/invalid or expired/i);
    await expect(
      verifyAuth0AccessToken(await token({ tokenSubject: null }), config, keyResolver)
    ).rejects.toThrow(/missing the subject/i);
    await expect(
      verifyAuth0AccessToken("old-static-token", config, keyResolver)
    ).rejects.toThrow(/invalid or expired/i);
  });

  it("logs only a bounded token shape when a non-JWT token is rejected", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        verifyAuth0AccessToken("opaque-probe-private", config, keyResolver)
      ).rejects.toThrow(/invalid or expired/i);
      const warning = warnings.mock.calls.map(([line]) => String(line))
        .find((line) => line.includes('"event":"auth0_jwt_verify_failed"'));
      expect(warning).toBeDefined();
      expect(JSON.parse(warning!)).toMatchObject({
        reason: "Invalid Compact JWS",
        tokenShape: {
          segments: 1,
          lengthBand: "under-100",
          containsWhitespace: false,
          nestedBearerPrefix: false
        }
      });
      expect(warning).not.toContain("opaque-probe-private");
    } finally {
      warnings.mockRestore();
    }
  });

  it("rejects expired tokens and tokens with an excessive access-token lifetime", async () => {
    const now = Math.floor(Date.now() / 1_000);
    await expect(
      verifyAuth0AccessToken(await token({ issuedAt: now - 7_200, expiresAt: now - 3_600 }), config, keyResolver)
    ).rejects.toThrow(/invalid or expired/i);
    await expect(
      verifyAuth0AccessToken(await token({ issuedAt: now, expiresAt: now + 3_601 }), config, keyResolver)
    ).rejects.toThrow(/lifetime exceeds/i);
  });

  it("requires the session-start claim and rejects sessions that reached 180 days", async () => {
    const now = Math.floor(Date.now() / 1_000);
    await expect(
      verifyAuth0AccessToken(await token({ sessionStartedAt: null }), config, keyResolver)
    ).rejects.toThrow(/session start claim/i);
    await expect(
      verifyAuth0AccessToken(
        await token({ sessionStartedAt: now - config.auth0MaxSessionAgeSeconds }),
        config,
        keyResolver
      )
    ).rejects.toThrow(/fresh Auth0 login every 180 days/i);
    await expect(
      verifyAuth0AccessToken(
        await token({ sessionStartedAt: now - config.auth0MaxSessionAgeSeconds + 60 }),
        config,
        keyResolver
      )
    ).resolves.toMatchObject({ authentication: "auth0-oauth" });
  });

  it("accepts tokens without the optional Enterprise session claim", async () => {
    await expect(
      verifyAuth0AccessToken(
        await token({ sessionStartedAt: null }),
        { ...config, auth0SessionStartedAtClaim: null },
        keyResolver
      )
    ).resolves.toMatchObject({
      authentication: "auth0-oauth",
      authInfo: { extra: { sessionStartedAt: null } }
    });
  });

  it("rejects a valid tenant user who is not on the optional owner allowlist", async () => {
    await expect(
      verifyAuth0AccessToken(await token({ tokenSubject: "auth0|someone-else" }), config, keyResolver)
    ).rejects.toMatchObject({ status: 403, oauthError: "insufficient_scope" });
  });

  it("keeps delegated OAuth scopes separate from Auth0 user permissions", () => {
    expect(extractTokenScopes({
      scope: LIFE_ARCHIVE_READ_SCOPE,
      scp: ["profile:read"],
      permissions: [LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE]
    })).toEqual([LIFE_ARCHIVE_READ_SCOPE, "profile:read"]);
    expect(extractTokenPermissions({
      permissions: [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE]
    })).toEqual([LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE]);
    expect(hasAllScopes(
      { scopes: extractTokenScopes({
        scope: LIFE_ARCHIVE_READ_SCOPE,
        permissions: [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE]
      }) },
      [LIFE_ARCHIVE_WRITE_SCOPE]
    )).toBe(false);
    expect(LIFE_ARCHIVE_OFFLINE_SCOPE).toBe("offline_access");
  });

  it("does not elevate a read-only client from the owner's broader RBAC permissions", async () => {
    const result = await verifyAuth0AccessToken(
      await token({
        scope: LIFE_ARCHIVE_READ_SCOPE,
        permissions: [LIFE_ARCHIVE_READ_SCOPE, LIFE_ARCHIVE_WRITE_SCOPE, LIFE_ARCHIVE_ADMIN_SCOPE]
      }),
      config,
      keyResolver
    );
    expect(result.scopes).toEqual([LIFE_ARCHIVE_READ_SCOPE]);
    expect(result.permissions).toEqual([
      LIFE_ARCHIVE_READ_SCOPE,
      LIFE_ARCHIVE_WRITE_SCOPE,
      LIFE_ARCHIVE_ADMIN_SCOPE
    ]);
    expect(result.canManageClients).toBe(false);
    expect(hasAllScopes(result, [LIFE_ARCHIVE_WRITE_SCOPE])).toBe(false);
    expect(hasAllScopes(result, [LIFE_ARCHIVE_ADMIN_SCOPE])).toBe(false);
  });
});
