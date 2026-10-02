// In memory and per server instance: not shared between Vercel instances, and reset when an
// instance starts. It slows down a script hammering one instance; it is not a quota
// (docs/security.md).
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_REQUESTS = 5;
// Above this many tracked addresses, expired entries are dropped, so the map cannot grow without
// bound.
const MAX_TRACKED_CLIENTS = 10_000;

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type RateLimiter = (client: string, now: number) => RateLimitDecision;

export function createRateLimiter(
  windowMs = RATE_LIMIT_WINDOW_MS,
  maxRequests = RATE_LIMIT_MAX_REQUESTS,
): RateLimiter {
  const requests = new Map<string, number[]>();

  return (client, now) => {
    if (requests.size >= MAX_TRACKED_CLIENTS) {
      for (const [key, times] of requests) {
        if (times.every((time) => now - time >= windowMs)) requests.delete(key);
      }
    }
    const recent = (requests.get(client) ?? []).filter((time) => now - time < windowMs);
    const oldest = recent[0];
    if (recent.length >= maxRequests && oldest !== undefined) {
      requests.set(client, recent);
      return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000) };
    }
    requests.set(client, [...recent, now]);
    return { allowed: true };
  };
}

// Vercel overwrites x-forwarded-for with the client address and does not forward a value sent by
// the client. Locally the header is absent and every request shares one bucket.
export function clientAddress(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
