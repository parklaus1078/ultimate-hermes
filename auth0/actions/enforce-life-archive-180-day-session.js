/**
 * Optional Auth0 Enterprise Post-Login Action for Life Archive MCP.
 *
 * Required Action secret:
 *   LIFE_ARCHIVE_AUDIENCE=https://your-life-archive.example.com/mcp
 *
 * Auth0's per-application refresh-token maximum lifetime remains the primary
 * 180-day control. This Action mirrors that absolute expiry into access tokens
 * so the MCP server can enforce the same boundary independently.
 *
 * Auth0 exposes event.refresh_token during refresh exchanges only on eligible
 * Enterprise plans. Do not install this Action on plans without that feature.
 */

const MAX_SESSION_AGE_MS = 180 * 24 * 60 * 60 * 1000;

exports.onExecutePostLogin = async (event, api) => {
  const audience = event.resource_server?.identifier;
  const expectedAudience = event.secrets.LIFE_ARCHIVE_AUDIENCE;
  if (!audience || !expectedAudience || audience !== expectedAudience) return;

  const nowMs = Date.now();
  const isRefreshExchange =
    Boolean(event.refresh_token) || event.transaction?.protocol === "oauth2-refresh-token";
  if (isRefreshExchange && !event.refresh_token) {
    api.access.deny(
      "Life Archive cannot verify the refresh-token family start. Reconnect without the optional Enterprise Action."
    );
    return;
  }

  const refreshTokenExpiresAtMs = event.refresh_token?.expires_at
    ? Date.parse(event.refresh_token.expires_at)
    : Number.NaN;
  const refreshTokenCreatedAtMs = event.refresh_token?.created_at
    ? Date.parse(event.refresh_token.created_at)
    : Number.NaN;
  if (
    isRefreshExchange &&
    !Number.isFinite(refreshTokenExpiresAtMs) &&
    !Number.isFinite(refreshTokenCreatedAtMs)
  ) {
    api.access.deny("Life Archive cannot determine the refresh-token family start time.");
    return;
  }
  const sessionStartedAtMs = Number.isFinite(refreshTokenExpiresAtMs)
    ? refreshTokenExpiresAtMs - MAX_SESSION_AGE_MS
    : Number.isFinite(refreshTokenCreatedAtMs)
      ? refreshTokenCreatedAtMs
      : nowMs;

  if (isRefreshExchange && nowMs - sessionStartedAtMs >= MAX_SESSION_AGE_MS) {
    api.refreshToken.revoke("Life Archive requires a fresh login every 180 days.");
    return;
  }

  const sessionStartedAt = Math.floor(sessionStartedAtMs / 1000);
  const requestedScopes = event.transaction?.requested_scopes ?? [];
  const refreshTokenExpected = isRefreshExchange || requestedScopes.includes("offline_access");

  if (refreshTokenExpected) {
    api.refreshToken.setExpiresAt(sessionStartedAtMs + MAX_SESSION_AGE_MS);
  }

  api.accessToken.setCustomClaim(
    `${audience.replace(/\/$/, "")}/session_started_at`,
    sessionStartedAt
  );
};
