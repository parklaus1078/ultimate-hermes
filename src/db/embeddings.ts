import { createHermesId } from "../core/ids.js";
import type { Sensitivity } from "../core/types.js";
import { query } from "./client.js";

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number.isFinite(value) ? value.toFixed(8) : "0").join(",")}]`;
}

export class EmbeddingRepository {
  async upsert(input: {
    hermesObjectType: "event" | "source" | "entity";
    hermesObjectId: string;
    embeddingModel: string;
    embedding: number[];
    contentHash: string;
    sensitivity: Sensitivity;
  }): Promise<void> {
    await query(
      `insert into embeddings (
        id, hermes_object_type, hermes_object_id, embedding_model, embedding, content_hash, sensitivity
      ) values ($1, $2, $3, $4, $5::vector, $6, $7)
      on conflict (hermes_object_type, hermes_object_id, embedding_model, content_hash)
      do nothing`,
      [
        createHermesId("emb"),
        input.hermesObjectType,
        input.hermesObjectId,
        input.embeddingModel,
        vectorLiteral(input.embedding),
        input.contentHash,
        input.sensitivity
      ]
    );
  }

  async searchEvents(input: { embedding: number[]; model: string; limit: number }): Promise<Array<{ eventId: string; score: number }>> {
    const result = await query(
      `select hermes_object_id as event_id,
              1 - (embedding <=> $1::vector) as score
       from embeddings
       where hermes_object_type = 'event'
         and embedding_model = $2
       order by embedding <=> $1::vector
       limit $3`,
      [vectorLiteral(input.embedding), input.model, input.limit]
    );
    return result.rows.map((row) => ({
      eventId: row.event_id as string,
      score: Number(row.score)
    }));
  }
}
