export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until one token is available. 0 when allowed. */
  retryAfterSec: number;
}

interface Bucket { tokens: number; last: number }

/**
 * Token bucket per key. Each key starts full, refills at `rps` tokens per second up to `burst`, and each
 * allowed request takes one token. `now` is injectable so tests can drive the clock.
 * Memory is bounded: `maxEntries` caps the map (oldest-used key evicted first) and `sweep()` drops
 * buckets that have refilled to full, which is equivalent to not having them at all.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly rps: number,
    private readonly burst: number,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 50_000,
  ) {
    if (!(rps > 0)) throw new Error("rps must be > 0");
    if (!(burst >= 1)) throw new Error("burst must be >= 1");
  }

  take(key: string): RateLimitDecision {
    const t = this.now();
    let bucket = this.buckets.get(key);
    if (bucket) {
      // Re-insert so Map iteration order tracks recency: the first key is always the least recently used.
      this.buckets.delete(key);
    } else {
      if (this.buckets.size >= this.maxEntries) this.evictOldest();
      bucket = { tokens: this.burst, last: t };
    }
    bucket.tokens = Math.min(this.burst, bucket.tokens + (Math.max(0, t - bucket.last) / 1000) * this.rps);
    bucket.last = t;

    let decision: RateLimitDecision;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      decision = { allowed: true, retryAfterSec: 0 };
    } else {
      decision = { allowed: false, retryAfterSec: Math.max(1, Math.ceil((1 - bucket.tokens) / this.rps)) };
    }
    this.buckets.set(key, bucket);
    return decision;
  }

  /** Removes buckets that have been idle long enough to refill completely. Returns how many were removed. */
  sweep(): number {
    const t = this.now();
    const fullAfterMs = (this.burst / this.rps) * 1000;
    let removed = 0;
    for (const [key, bucket] of this.buckets) {
      if (t - bucket.last >= fullAfterMs) {
        this.buckets.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.buckets.size;
  }

  private evictOldest(): void {
    const first = this.buckets.keys().next();
    if (!first.done) this.buckets.delete(first.value);
  }
}
