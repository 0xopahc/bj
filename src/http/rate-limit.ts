interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function bucket(key: string, windowMs: number): Bucket {
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 0, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  return current;
}

export function tooManyFailures(key: string, limit: number, windowMs: number): boolean {
  return bucket(key, windowMs).count >= limit;
}

export function noteFailure(key: string, windowMs: number): void {
  bucket(key, windowMs).count += 1;
}

export function clearFailures(key: string): void {
  buckets.delete(key);
}

export function takeToken(key: string, limit: number, windowMs: number): boolean {
  const current = bucket(key, windowMs);
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}
