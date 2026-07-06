import { loadConfig } from "../config/env.js";
import { AuditRepository } from "../db/audit.js";
import { EventRepository } from "../db/events.js";
import { SourceRepository } from "../db/sources.js";
import { createSecretStore } from "../secrets/index.js";
import { createEmbeddingProvider } from "../search/embedding-provider.js";

export function createCliContext() {
  const config = loadConfig();
  const secretStore = createSecretStore();
  const embeddingProvider = createEmbeddingProvider(secretStore);

  return {
    config,
    secretStore,
    embeddingProvider,
    events: new EventRepository(),
    sources: new SourceRepository(),
    audit: new AuditRepository()
  };
}
