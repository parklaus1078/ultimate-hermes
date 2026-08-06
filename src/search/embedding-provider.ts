import { createHash } from "node:crypto";
import { loadConfig } from "../config/env.js";
import type { SecretStore } from "../secrets/secret-store.js";
import { normalizeVector } from "./vector.js";

export interface EmbeddingProvider {
  model: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
}

export class LocalDeterministicEmbeddingProvider implements EmbeddingProvider {
  readonly model = "local-deterministic-v1";

  constructor(readonly dimensions = 1536) {}

  async embed(text: string): Promise<number[]> {
    const values = new Array<number>(this.dimensions).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);

    const usableTokens = tokens.length ? tokens : [text.toLowerCase()];
    for (const token of usableTokens) {
      const digest = createHash("sha256").update(token).digest();
      for (let i = 0; i < digest.length; i += 2) {
        const index = digest[i]! % this.dimensions;
        const signByte = digest[i + 1] ?? digest[0] ?? 0;
        const sign = signByte % 2 === 0 ? 1 : -1;
        values[index] = (values[index] ?? 0) + sign;
      }
    }

    return normalizeVector(values);
  }
}

export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;

  constructor(
    private readonly secretStore: SecretStore,
    private readonly keyRef: { service: string; account: string },
    private readonly url = loadConfig().embeddingUrl,
    model = loadConfig().embeddingModel,
    dimensions = loadConfig().embeddingDimensions
  ) {
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const apiKey =
      process.env.HERMES_EMBEDDING_API_KEY ||
      process.env.OPENAI_API_KEY ||
      (await this.secretStore.get(this.keyRef.service, this.keyRef.account));
    if (!apiKey) {
      throw new Error(`Missing embedding API key in ${this.keyRef.service}/${this.keyRef.account}`);
    }

    const response = await fetch(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        input: text
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) throw new Error("Embedding response did not include data[0].embedding");
    if (embedding.length !== this.dimensions) {
      throw new Error(`Embedding dimension mismatch: expected ${this.dimensions}, got ${embedding.length}`);
    }
    return normalizeVector(embedding);
  }
}

export function createEmbeddingProvider(secretStore: SecretStore): EmbeddingProvider {
  const config = loadConfig();
  if (config.embeddingProvider === "http") {
    return new HttpEmbeddingProvider(
      secretStore,
      config.keychain.embedding,
      config.embeddingUrl,
      config.embeddingModel,
      config.embeddingDimensions
    );
  }
  return new LocalDeterministicEmbeddingProvider(config.embeddingDimensions);
}
