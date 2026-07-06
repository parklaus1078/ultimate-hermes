import { describe, expect, it } from "vitest";
import { LocalHashEmbeddingProvider } from "../../src/search/embeddings.js";

describe("LocalHashEmbeddingProvider", () => {
  it("returns deterministic normalized vectors", async () => {
    const provider = new LocalHashEmbeddingProvider(32);
    const first = await provider.embed("linear project memory");
    const second = await provider.embed("linear project memory");
    expect(first).toEqual(second);
    expect(first).toHaveLength(32);
    const magnitude = Math.sqrt(first.reduce((sum, value) => sum + value * value, 0));
    expect(magnitude).toBeCloseTo(1, 8);
  });
});
