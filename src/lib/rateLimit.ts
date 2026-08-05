// Best-effort in-memory rate limiter for the login endpoint.
//
// Note: this resets whenever the serverless function cold-starts, and
// each Vercel instance has its own memory, so it is not a bulletproof
// defense on its own. Combined with the artificial delay in /api/login
// and the fact that the app URL is not publicly advertised, it's enough
// friction for this app's threat model (a 4-digit shared PIN meant to
// keep out passersby, not a determined attacker).

type Bucket = { failures: number; blockedUntil: number };

const buckets = new Map<string, Bucket>();

const MAX_FAILURES = 8;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BLOCK_MS = 15 * 60 * 1000; // 15 minutes

export function isBlocked(key: string): boolean {
  const bucket = buckets.get(key);
  if (!bucket) return false;
  return bucket.blockedUntil > Date.now();
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.blockedUntil < now - WINDOW_MS) {
    buckets.set(key, { failures: 1, blockedUntil: 0 });
    return;
  }

  const failures = bucket.failures + 1;
  const blockedUntil = failures >= MAX_FAILURES ? now + BLOCK_MS : 0;
  buckets.set(key, { failures, blockedUntil });
}

export function recordSuccess(key: string): void {
  buckets.delete(key);
}
