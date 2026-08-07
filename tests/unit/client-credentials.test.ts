import { describe, expect, it } from "vitest";
import {
  createClientCredential,
  createEnrollmentCredential,
  hashCredential,
  parseClientCredential,
  parseEnrollmentCredential,
  safeHashEqual
} from "../../src/remote/client-credentials.js";

describe("per-client credentials", () => {
  it("generates a high-entropy client key with an indexable public key id", () => {
    const credential = createClientCredential();
    expect(credential.value).toMatch(/^uhm_[a-f0-9]{16}_[a-f0-9]{64}$/);
    expect(credential.hash).toBe(hashCredential(credential.value));
    expect(parseClientCredential(credential.value)).toEqual({ keyId: credential.id, hash: credential.hash });
  });

  it("generates a separate short-lived enrollment credential namespace", () => {
    const credential = createEnrollmentCredential();
    expect(credential.value).toMatch(/^uhe_[a-f0-9]{16}_[a-f0-9]{64}$/);
    expect(parseEnrollmentCredential(credential.value)).toEqual({
      enrollmentId: credential.id,
      hash: credential.hash
    });
    expect(parseClientCredential(credential.value)).toBeNull();
  });

  it("compares only valid SHA-256 digests in constant-sized buffers", () => {
    const hash = hashCredential("secret");
    expect(safeHashEqual(hash, hash)).toBe(true);
    expect(safeHashEqual(hash, hashCredential("other"))).toBe(false);
    expect(safeHashEqual("not-a-hash", hash)).toBe(false);
  });
});
