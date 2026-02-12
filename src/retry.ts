export type RetryOptions = {
  maxRetries: number;
  baseBackoffMs: number;
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
  const { maxRetries, baseBackoffMs, onError, shouldRetry } = opts;

  let attempt = 0;
  // Attempts = initial + retries
  // attempt index: 0..maxRetries
  // delays happen after a failed attempt if another attempt will be made.
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      onError?.(err, attempt);
      if (attempt >= maxRetries || !shouldRetry(err)) throw err;
      await sleep(computeDelayMs(baseBackoffMs, attempt));
      attempt += 1;
    }
  }
}
