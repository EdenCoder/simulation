/**
 * Simple rate limiter that enforces a minimum gap between calls.
 */
export class RateLimiter {
  private lastCallTime = 0;

  constructor(private minGapMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastCallTime;
    if (elapsed < this.minGapMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minGapMs - elapsed));
    }
    this.lastCallTime = Date.now();
  }
}
