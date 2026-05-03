// lib/rateLimiter.js
// Simple in-memory sliding-window rate limiter.
// For production with multiple instances, swap to Upstash Redis.

const WINDOW_MS = 60_000;   // 1 minute
// Free tier: ~15 req/min total. Each chat uses ~3 Gemini calls (embed + profile + chat).
// So 5 msgs/min is the safe upper bound to avoid quota exhaustion.
const MAX_REQUESTS = 5;

// Map<ip, { count: number, windowStart: number }>
const store = new Map();

/**
 * Returns true if the IP is within rate limits, false if exceeded.
 * @param {string} ip
 */
export function checkRateLimit(ip) {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now - entry.windowStart > WINDOW_MS) {
    store.set(ip, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= MAX_REQUESTS) {
    return false;
  }

  entry.count += 1;
  return true;
}

// Periodically clean up expired entries to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store.entries()) {
    if (now - entry.windowStart > WINDOW_MS * 2) store.delete(ip);
  }
}, WINDOW_MS * 5);
