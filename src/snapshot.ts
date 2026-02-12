import { withRetries } from './retry.js';
import { sha256Hex } from './hash.js';
import { normalizeHtmlToSnapshot } from './normalize.js';
import type { SentinelInput, Snapshot } from './types.js';

export class HttpError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

function isRetryableFetchError(err: unknown): boolean {
  if (err instanceof HttpError) {
    // Retry on 429 and 5xx.
    return err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode <= 599);
  }

  // Fetch can throw TypeError for network issues.
  if (err instanceof TypeError) return true;

  // Node's fetch may surface AbortError on timeouts; retry those.
  if (err instanceof Error && err.name === 'AbortError') return true;

  return false;
}

async function fetchText(url: string, timeoutSecs: number): Promise<{ status: number; headers: Headers; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSecs * 1000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // A clear UA tends to reduce bot-blocking ambiguity.
        'user-agent': 'SentinelWebhook/0.1 (+https://github.com/firasmosbehi/sentinel-webhook)',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    const text = await res.text();
    return { status: res.status, headers: res.headers, text };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildSnapshot(input: SentinelInput): Promise<Snapshot> {
  const { max_retries, retry_backoff_ms, timeout_secs, target_url, selector, ignore_selectors, ignore_regexes } =
    input;

  const { status, headers, text: html } = await withRetries(
    async () => {
      const res = await fetchText(target_url, timeout_secs);
      if (res.status >= 400) {
        throw new HttpError(`Fetch failed with status ${res.status}`, res.status);
      }
      return res;
    },
    {
      maxRetries: max_retries,
      baseBackoffMs: retry_backoff_ms,
      shouldRetry: isRetryableFetchError,
    },
  );

  const extracted = normalizeHtmlToSnapshot(html, {
    selector,
    ignoreSelectors: ignore_selectors,
    ignoreRegexes: ignore_regexes,
  });

  const fetchedAt = new Date().toISOString();

  return {
    url: target_url,
    selector,
    fetchedAt,
    statusCode: status,
    contentType: headers.get('content-type') ?? undefined,
    etag: headers.get('etag') ?? undefined,
    lastModified: headers.get('last-modified') ?? undefined,
    text: extracted.text,
    html: extracted.html,
    contentHash: sha256Hex(extracted.text),
  };
}

