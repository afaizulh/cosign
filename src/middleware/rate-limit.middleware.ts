import type { Context, Next } from "hono";

type Bucket = { count: number; resetAt: number };

/**
 * In-memory fixed-window rate limiter keyed by client IP (+ optional extra key).
 * ponytail: single-process memory only — swap for Redis/DB if you run multiple
 * instances or need to survive restarts.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  keyFrom?: (c: Context) => string;
}) {
  const buckets = new Map<string, Bucket>();

  return async (c: Context, next: Next) => {
    const ip =
      c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
      c.req.header("x-real-ip") ||
      "local";
    const key = opts.keyFrom ? `${ip}:${opts.keyFrom(c)}` : ip;
    const now = Date.now();

    let b = buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count++;

    if (b.count > opts.max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      c.header("Retry-After", String(retry));
      return c.text("Too many attempts. Please try again later.", 429);
    }

    // Opportunistic cleanup so the map doesn't grow unbounded.
    if (buckets.size > 10_000) {
      for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
    }

    await next();
  };
}
