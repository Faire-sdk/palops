/**
 * Small fixed-window, in-memory limiter. Good enough for a single panel
 * process; swap for a shared store if the panel is ever scaled out.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true when the key is still under its limit, and counts the hit. */
  consume(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    return !!entry && entry.resetAt > now && entry.count >= this.limit;
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    if (this.hits.size < 10_000) return;
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}
