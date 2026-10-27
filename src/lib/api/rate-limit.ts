/* Fixed-window rate limiting for Bliss' public routes.

 * The product is anonymous, so an IP bucket is the only handle available — and an
 * unbounded free endpoint is an invitation to a bill. Each limiter keeps its own map;
 * the bucket count is opportunistically pruned so a long-lived container can't leak.
 *
 * This is a process-local guard. For multi-instance precision pair it with Vercel KV
 * or Upstash.
 */
export interface Limiter {
  isLimited(ip: string): boolean;
  /** Test seam. */
  reset(): void;
}

export function createLimiter(limit: number, windowMs = 60_000): Limiter {
  const buckets = new Map<string, { count: number; reset: number }>();
  return {
    isLimited(ip: string): boolean {
      const now = Date.now();
      if (buckets.size > 5_000) {
        for (const [key, value] of buckets)
          if (value.reset < now) buckets.delete(key);
      }
      const bucket = buckets.get(ip);
      if (!bucket || bucket.reset < now) {
        buckets.set(ip, { count: 1, reset: now + windowMs });
        return false;
      }
      bucket.count += 1;
      return bucket.count > limit;
    },
    reset() {
      buckets.clear();
    },
  };
}

/** Best available client identity for a serverless request. */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
