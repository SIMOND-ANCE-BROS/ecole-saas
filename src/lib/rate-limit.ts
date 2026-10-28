/**
 * In-process limits for calls to an external service (#207). The clock is
 * passed in (milliseconds): pure, testable, nothing stored outside the
 * object. One server instance only: several instances each get the budget.
 */

/** Token bucket: `capacity` calls at once, then `perSecond` calls per second. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
    now: number,
  ) {
    this.tokens = capacity;
    this.at = now;
  }

  /** Takes a token if there is one; false when the budget is spent. */
  take(now: number): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** Full again: the bucket can be forgotten. */
  idle(now: number): boolean {
    return this.tokens + ((now - this.at) / 1000) * this.perSecond >= this.capacity;
  }
}

/** Circuit breaker: after a « slow down » from the service, no call until it reopens. */
export class Breaker {
  private until = 0;

  open(now: number, forMs: number): void {
    this.until = Math.max(this.until, now + forMs);
  }

  isOpen(now: number): boolean {
    return now < this.until;
  }
}

/** Buckets by key (a member), forgotten once full again so the map stays small. */
export class KeyedBuckets {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly perSecond: number,
  ) {}

  take(key: string, now: number): boolean {
    if (this.buckets.size > 1000) for (const [k, b] of this.buckets) if (b.idle(now)) this.buckets.delete(k);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.perSecond, now);
      this.buckets.set(key, bucket);
    }
    return bucket.take(now);
  }
}
