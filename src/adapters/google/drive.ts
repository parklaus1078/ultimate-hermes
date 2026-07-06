import type { SecretStore } from "../../secrets/secret-store.js";
import { GoogleApiClient } from "./client.js";

export async function checkGoogleDrive(secretStore: SecretStore): Promise<unknown> {
  return new GoogleApiClient(secretStore).listDriveFiles(3);
}
