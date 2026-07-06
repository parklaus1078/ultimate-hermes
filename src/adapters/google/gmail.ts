import type { SecretStore } from "../../secrets/secret-store.js";
import { GoogleApiClient } from "./client.js";

export async function checkGmail(secretStore: SecretStore): Promise<unknown> {
  return new GoogleApiClient(secretStore).listGmailMessages(3);
}
