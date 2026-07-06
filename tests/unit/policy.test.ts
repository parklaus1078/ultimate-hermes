import { describe, expect, it } from "vitest";
import { decidePolicy } from "../../src/core/policy.js";

describe("policy gate", () => {
  it("allows local writes", () => {
    expect(decidePolicy("local_event_write", "personal").allowed).toBe(true);
  });

  it("blocks legal-sensitive embeddings by default", () => {
    const decision = decidePolicy("embedding_generate", "legal_sensitive");
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it("requires approval for external writes", () => {
    const decision = decidePolicy("notion_write", "personal");
    expect(decision.allowed).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });
});
