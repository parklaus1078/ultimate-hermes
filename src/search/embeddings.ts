import { createHermesId } from "../core/ids.js";
import { decidePolicy } from "../core/policy.js";
import type { HermesEvent } from "../core/types.js";
import { query } from "../db/client.js";
import { sha256Text } from "../core/files.js";
import { EventRepository as DbEventRepository } from "../db/events.js";
import { EmbeddingRepository as DbEmbeddingRepository } from "../db/embeddings.js";
import { loadConfig } from "../config/env.js";
import type { SecretStore } from "../secrets/secret-store.js";
import {
  HttpEmbeddingProvider as BaseHttpEmbeddingProvider,
  LocalDeterministicEmbeddingProvider,
  type EmbeddingProvider
} from "./embedding-provider.js";
import { vectorLiteral } from "./vector.js";

export type { EmbeddingProvider } from "./embedding-provider.js";

export class LocalHashEmbeddingProvider extends LocalDeterministicEmbeddingProvider {}

export class HttpEmbeddingProvider extends BaseHttpEmbeddingProvider {
  constructor(secretStore: SecretStore) {
    const config = loadConfig();
    super(secretStore, config.keychain.embedding, config.embeddingUrl, config.embeddingModel, config.embeddingDimensions);
  }
}

export type EmbeddingSearchResult = {
  hermesObjectType: string;
  hermesObjectId: string;
  score: number;
};

export class EmbeddingRepository {
  constructor(private readonly provider: EmbeddingProvider) {}

  async upsertForEvent(event: HermesEvent, allowSensitive = false): Promise<boolean> {
    const decision = decidePolicy("embedding_generate", event.sensitivity);
    if (!decision.allowed && !allowSensitive) return false;

    const content = [event.title, event.summary, event.body].filter(Boolean).join("\n\n");
    if (!content.trim()) return false;

    const hash = sha256Text(content);
    const embedding = await this.provider.embed(content);
    await query(
      `insert into embeddings (
        id, hermes_object_type, hermes_object_id, embedding_model,
        embedding, content_hash, sensitivity
      ) values ($1,'event',$2,$3,$4::vector,$5,$6)
      on conflict (hermes_object_type, hermes_object_id, embedding_model, content_hash)
      do nothing`,
      [createHermesId("emb"), event.id, this.provider.model, vectorLiteral(embedding), hash, event.sensitivity]
    );
    return true;
  }

  async search(text: string, options: { limit?: number; includeSensitive?: boolean } = {}): Promise<EmbeddingSearchResult[]> {
    const embedding = await this.provider.embed(text);
    const includeSensitive = options.includeSensitive ?? false;
    const result = await query(
      `select hermes_object_type,
              hermes_object_id,
              1 - (embedding <=> $1::vector) as score
       from embeddings
       where ($3::boolean or sensitivity <> 'legal_sensitive')
       order by embedding <=> $1::vector
       limit $2`,
      [vectorLiteral(embedding), options.limit ?? 10, includeSensitive]
    );

    return result.rows.map((row) => ({
      hermesObjectType: row.hermes_object_type as string,
      hermesObjectId: row.hermes_object_id as string,
      score: Number(row.score)
    }));
  }

  async regenerate(events: HermesEvent[], options: { includeSensitive?: boolean } = {}): Promise<number> {
    let count = 0;
    for (const event of events) {
      const ok = await this.upsertForEvent(event, options.includeSensitive ?? false);
      if (ok) count += 1;
    }
    return count;
  }
}

export class EmbeddingService {
  constructor(
    private readonly provider: EmbeddingProvider,
    private readonly events = new DbEventRepository(),
    private readonly embeddings = new DbEmbeddingRepository()
  ) {}

  async embedRecentEvents(limit = 100): Promise<{ embedded: number; skipped: number }> {
    const events = await this.events.listRecent(limit);
    let embedded = 0;
    let skipped = 0;

    for (const event of events) {
      const decision = decidePolicy("embedding_generate", event.sensitivity);
      if (!decision.allowed) {
        skipped += 1;
        continue;
      }
      const text = [event.title, event.summary, event.body].filter(Boolean).join("\n\n");
      if (!text.trim()) {
        skipped += 1;
        continue;
      }
      const vector = await this.provider.embed(text);
      await this.embeddings.upsert({
        hermesObjectType: "event",
        hermesObjectId: event.id,
        embeddingModel: this.provider.model,
        embedding: vector,
        contentHash: sha256Text(text),
        sensitivity: event.sensitivity
      });
      embedded += 1;
    }

    return { embedded, skipped };
  }
}
