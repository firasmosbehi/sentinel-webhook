export type RetryOptions = {
  maxRetries: number;
  baseBackoffMs: number;
  // If set, retrying will stop once the total elapsed time exceeds this limit.
  // The time budget includes the time spent executing attempts and backoff delays.
  maxTotalTimeMs?: number;
  // Attempt is 0-based and is provided so callers can include it in logs.
  onError?: (err: unknown, attempt: number) => void;
  shouldRetry: (err: unknown) => boolean;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelayMs(base: number, attempt: number): number {
  // Exponential backoff with small jitter.
  const maxJitter = Math.min(250, base);
  const jitter = Math.floor(Math.random() * (maxJitter + 1));
  return base * 2 ** attempt + jitter;
}

export async function withRetries<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const { maxRetries, baseBackoffMs, maxTotalTimeMs, onError, shouldRetry } = opts;

  let attempt = 0;
  let lastErr: unknown | undefined;
  const startedAt = Date.now();
  // Attempts = initial + retries
  // attempt index: 0..maxRetries
  // delays happen after a failed attempt if another attempt will be made.
  while (true) {
    if (typeof maxTotalTimeMs === 'number' && maxTotalTimeMs >= 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed > maxTotalTimeMs) {
        if (lastErr !== undefined) throw lastErr;
        throw new Error(`Retry time budget exceeded (${elapsed}ms > ${maxTotalTimeMs}ms).`);
      }
    }

    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      onError?.(err, attempt);
      if (attempt >= maxRetries || !shouldRetry(err)) throw err;

      const delay = computeDelayMs(baseBackoffMs, attempt);
      if (typeof maxTotalTimeMs === 'number' && maxTotalTimeMs >= 0) {
        const elapsed = Date.now() - startedAt;
        const remaining = maxTotalTimeMs - elapsed;
        if (remaining <= 0 || delay > remaining) throw err;
      }

      await sleep(delay);
      attempt += 1;
    }
  }
}
