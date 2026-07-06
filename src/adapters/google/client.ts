import type { SecretStore } from "../../secrets/secret-store.js";
import { GoogleOAuthClient } from "./oauth.js";

export class GoogleApiClient {
  private readonly oauth: GoogleOAuthClient;

  constructor(secretStore: SecretStore) {
    this.oauth = new GoogleOAuthClient(secretStore);
  }

  private async request<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${await this.oauth.accessToken()}`
      }
    });
    if (!response.ok) throw new Error(`Google API failed: ${response.status} ${await response.text()}`);
    return await response.json() as T;
  }

  async listCalendarEvents(calendarId = "primary", maxResults = 10): Promise<unknown> {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("timeMin", new Date().toISOString());
    url.searchParams.set("maxResults", String(maxResults));
    return this.request(url.toString());
  }

  async listDriveFiles(pageSize = 10): Promise<unknown> {
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("pageSize", String(pageSize));
    url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink)");
    return this.request(url.toString());
  }

  async listGmailMessages(maxResults = 10): Promise<unknown> {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("maxResults", String(maxResults));
    return this.request(url.toString());
  }
}
