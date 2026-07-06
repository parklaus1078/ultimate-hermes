import type { SecretStore } from "../../secrets/secret-store.js";
import { NotionClient } from "./client.js";

export async function checkNotionConnection(secretStore: SecretStore): Promise<unknown> {
  return new NotionClient(secretStore).search("Hermes");
}
