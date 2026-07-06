import { loadConfig } from "../../config/env.js";
import type { SecretStore } from "../../secrets/secret-store.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/gmail.readonly"
];

export class GoogleOAuthClient {
  constructor(private readonly secretStore: SecretStore) {}

  async authUrl(redirectUri: string, state = "hermes"): Promise<string> {
    const config = loadConfig();
    const clientId = await this.secretStore.get(config.keychain.googleClient.service, config.keychain.googleClient.clientIdAccount);
    if (!clientId) {
      throw new Error(`Missing Google OAuth client_id in ${this.secretStore.describe()} service=${config.keychain.googleClient.service} account=${config.keychain.googleClient.clientIdAccount}`);
    }
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
    url.searchParams.set("state", state);
    return url.toString();
  }

  async exchangeCode(code: string, redirectUri: string): Promise<Record<string, unknown>> {
    const config = loadConfig();
    const clientId = await this.secretStore.get(config.keychain.googleClient.service, config.keychain.googleClient.clientIdAccount);
    const clientSecret = await this.secretStore.get(config.keychain.googleClient.service, config.keychain.googleClient.clientSecretAccount);
    if (!clientId || !clientSecret) throw new Error("Missing Google OAuth client credentials in secret store.");

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code"
      })
    });
    if (!response.ok) throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
    const tokens = await response.json() as Record<string, unknown>;
    await this.secretStore.set(config.keychain.googleToken.service, config.keychain.googleToken.account, JSON.stringify(tokens));
    return tokens;
  }

  async accessToken(): Promise<string> {
    const config = loadConfig();
    const raw = await this.secretStore.get(config.keychain.googleToken.service, config.keychain.googleToken.account);
    if (!raw) throw new Error(`Missing Google OAuth token in ${this.secretStore.describe()} service=${config.keychain.googleToken.service} account=${config.keychain.googleToken.account}`);
    const tokens = JSON.parse(raw) as { access_token?: string };
    if (!tokens.access_token) throw new Error("Stored Google OAuth token has no access_token. Reconnect Google.");
    return tokens.access_token;
  }
}
