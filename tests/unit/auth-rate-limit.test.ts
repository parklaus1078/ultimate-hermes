import { describe, expect, it } from "vitest";
import { AuthFailureRateLimiter } from "../../src/remote/auth-rate-limit.js";

function limiter(now: { value: number }, overrides: Partial<ConstructorParameters<typeof AuthFailureRateLimiter>[0]> = {}) {
  return new AuthFailureRateLimiter({
    enabled: true,
    maxFailures: 3,
    windowMs: 60_000,
    blockMs: 120_000,
    maxEntries: 100,
    ...overrides
  }, () => now.value);
}

describe("authentication failure rate limiter", () => {
  it("blocks at the configured threshold and automatically expires the block", () => {
    const now = { value: 1_000 };
    const subject = limiter(now);

    expect(subject.recordFailure("203.0.113.10")).toMatchObject({ blocked: false, failures: 1 });
    expect(subject.recordFailure("203.0.113.10")).toMatchObject({ blocked: false, failures: 2 });
    expect(subject.recordFailure("203.0.113.10")).toMatchObject({
      blocked: true,
      failures: 3,
      retryAfterSeconds: 120
    });

    now.value += 119_999;
    expect(subject.check("203.0.113.10").blocked).toBe(true);
    now.value += 1;
    expect(subject.check("203.0.113.10")).toEqual({ blocked: false, retryAfterSeconds: 0, failures: 0 });
  });

  it("forgets failures outside the rolling window", () => {
    const now = { value: 10_000 };
    const subject = limiter(now, { windowMs: 1_000 });
    subject.recordFailure("203.0.113.11");
    now.value += 1_001;
    expect(subject.check("203.0.113.11")).toEqual({ blocked: false, retryAfterSeconds: 0, failures: 0 });
  });

  it("bounds memory when an attacker rotates source addresses", () => {
    const now = { value: 1_000 };
    const subject = limiter(now, { maxEntries: 2 });
    subject.recordFailure("203.0.113.1");
    subject.recordFailure("203.0.113.2");
    subject.recordFailure("203.0.113.3");
    expect(subject.entryCount).toBe(2);
    expect(subject.check("203.0.113.1").failures).toBe(0);
  });
});
