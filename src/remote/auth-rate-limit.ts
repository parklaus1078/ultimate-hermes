export type AuthRateLimitOptions = {
  enabled: boolean;
  maxFailures: number;
  windowMs: number;
  blockMs: number;
  maxEntries: number;
};

export type AuthRateLimitDecision = {
  blocked: boolean;
  retryAfterSeconds: number;
  failures: number;
};

type FailureBucket = {
  failures: number[];
  blockedUntil: number;
};

export class AuthFailureRateLimiter {
  readonly #buckets = new Map<string, FailureBucket>();
  readonly #now: () => number;
  #operations = 0;

  constructor(
    readonly options: AuthRateLimitOptions,
    now: () => number = Date.now
  ) {
    this.#now = now;
  }

  check(key: string | null): AuthRateLimitDecision {
    if (!this.options.enabled || !key) return this.#allowed(0);
    const now = this.#now();
    this.#periodicCleanup(now);
    const bucket = this.#activeBucket(key, now);
    if (!bucket) return this.#allowed(0);
    this.#touch(key, bucket);
    return bucket.blockedUntil > now
      ? this.#blocked(bucket, now)
      : this.#allowed(bucket.failures.length);
  }

  recordFailure(key: string | null): AuthRateLimitDecision {
    if (!this.options.enabled || !key) return this.#allowed(0);
    const now = this.#now();
    this.#periodicCleanup(now);
    const bucket = this.#activeBucket(key, now) ?? { failures: [], blockedUntil: 0 };
    if (bucket.blockedUntil > now) {
      this.#touch(key, bucket);
      return this.#blocked(bucket, now);
    }

    bucket.failures.push(now);
    if (bucket.failures.length >= this.options.maxFailures) {
      bucket.blockedUntil = now + this.options.blockMs;
    }
    this.#put(key, bucket);
    return bucket.blockedUntil > now
      ? this.#blocked(bucket, now)
      : this.#allowed(bucket.failures.length);
  }

  get entryCount(): number {
    return this.#buckets.size;
  }

  #activeBucket(key: string, now: number): FailureBucket | null {
    const bucket = this.#buckets.get(key);
    if (!bucket) return null;
    if (bucket.blockedUntil > now) return bucket;
    if (bucket.blockedUntil > 0 && bucket.blockedUntil <= now) {
      this.#buckets.delete(key);
      return null;
    }
    bucket.failures = bucket.failures.filter((timestamp) => timestamp > now - this.options.windowMs);
    if (bucket.failures.length === 0) {
      this.#buckets.delete(key);
      return null;
    }
    return bucket;
  }

  #put(key: string, bucket: FailureBucket): void {
    if (!this.#buckets.has(key) && this.#buckets.size >= this.options.maxEntries) {
      const oldest = this.#buckets.keys().next().value as string | undefined;
      if (oldest) this.#buckets.delete(oldest);
    }
    this.#touch(key, bucket);
  }

  #touch(key: string, bucket: FailureBucket): void {
    this.#buckets.delete(key);
    this.#buckets.set(key, bucket);
  }

  #periodicCleanup(now: number): void {
    this.#operations += 1;
    if (this.#operations % 128 !== 0) return;
    for (const [key, bucket] of this.#buckets) {
      const blockExpired = bucket.blockedUntil > 0 && bucket.blockedUntil <= now;
      const windowExpired = bucket.blockedUntil === 0 && bucket.failures.every((timestamp) => timestamp <= now - this.options.windowMs);
      if (blockExpired || windowExpired) this.#buckets.delete(key);
    }
  }

  #allowed(failures: number): AuthRateLimitDecision {
    return { blocked: false, retryAfterSeconds: 0, failures };
  }

  #blocked(bucket: FailureBucket, now: number): AuthRateLimitDecision {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
      failures: bucket.failures.length
    };
  }
}
