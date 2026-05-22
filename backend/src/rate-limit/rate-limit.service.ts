import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Bucket = {
  count: number;
  resetAt: number;
};

@Injectable()
export class RateLimitService {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly config: ConfigService) {}

  /**
   * Fixed-window counter per key. Returns false when limit exceeded.
   */
  tryConsume(key: string, namespace: string): boolean {
    const limit = this.getLimit();
    const windowMs = this.getWindowMs();
    const bucketKey = `${namespace}:${key}`;
    const now = Date.now();

    this.pruneExpired(now);

    const bucket = this.buckets.get(bucketKey);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  private getLimit(): number {
    const raw = Number(
      this.config.get<string>('RATE_LIMIT_BOOKING_MAX') ?? '120',
    );
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120;
  }

  private getWindowMs(): number {
    const raw = Number(
      this.config.get<string>('RATE_LIMIT_BOOKING_WINDOW_MS') ?? '600000',
    );
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 600_000;
  }

  private pruneExpired(now: number) {
    if (this.buckets.size < 500) return;
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt) this.buckets.delete(key);
    }
  }
}
