import type { SecretStore } from "../../secrets/secret-store.js";
import { GoogleApiClient } from "./client.js";

export async function checkGoogleCalendar(secretStore: SecretStore): Promise<unknown> {
  return new GoogleApiClient(secretStore).listCalendarEvents("primary", 3);
}
