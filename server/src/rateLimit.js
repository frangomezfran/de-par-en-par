/**
 * In-memory sliding-window IP rate limiter.
 */
export class MemoryRateLimiter {
  constructor(windowMs, maxRequests) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.hits = new Map();

    // Periodic cleanup of expired entries
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, Math.max(windowMs, 60000));
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  check(ip) {
    if (!ip) return true;
    const now = Date.now();
    const cutoff = now - this.windowMs;
    let timestamps = this.hits.get(ip);
    if (!timestamps) {
      timestamps = [];
      this.hits.set(ip, timestamps);
    }
    const recent = timestamps.filter(t => t > cutoff);
    if (recent.length >= this.maxRequests) {
      this.hits.set(ip, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(ip, recent);
    return true;
  }

  cleanup() {
    const cutoff = Date.now() - this.windowMs;
    for (const [ip, timestamps] of this.hits.entries()) {
      const recent = timestamps.filter(t => t > cutoff);
      if (recent.length === 0) {
        this.hits.delete(ip);
      } else {
        this.hits.set(ip, recent);
      }
    }
  }

  reset() {
    this.hits.clear();
  }

  destroy() {
    clearInterval(this.cleanupTimer);
  }
}

// 120 requests per minute per IP for general POST requests
export const generalPostLimiter = new MemoryRateLimiter(60 * 1000, 120);

// 5 comments per 10 minutes per IP
export const commentsLimiter = new MemoryRateLimiter(10 * 60 * 1000, 5);
