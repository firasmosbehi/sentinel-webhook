import { withRetries } from './retry.js';
import { sha256Hex } from './hash.js';
import { normalizeHtmlToSnapshot } from './normalize.js';
import { readResponseTextWithLimit } from './http.js';
import { assertSafeHttpUrl } from './url_safety.js';
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

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

export async function buildSnapshot(input: SentinelInput): Promise<Snapshot> {
  const {
    fetch_max_retries,
    fetch_retry_backoff_ms,
    fetch_timeout_secs,
    target_url,
    selector,
    ignore_selectors,
    ignore_regexes,
    max_redirects,
    max_content_bytes,
  } = input;

  const { status, headers, text: html } = await withRetries(
    async () => {
      let currentUrl = target_url;
      for (let i = 0; i <= max_redirects; i++) {
        await assertSafeHttpUrl(currentUrl, 'target_url');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), fetch_timeout_secs * 1000);
        try {
          const res = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: controller.signal,
            headers: {
              'user-agent': 'SentinelWebhook/0.1 (+https://github.com/firasmosbehi/sentinel-webhook)',
              accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          if (REDIRECT_STATUS_CODES.has(res.status)) {
            const loc = res.headers.get('location');
            if (!loc) throw new HttpError(`Redirect status ${res.status} missing Location header`, res.status);
            if (i === max_redirects) throw new HttpError(`Too many redirects (>${max_redirects})`, res.status);
            currentUrl = new URL(loc, currentUrl).toString();
            continue;
          }

          if (res.status >= 400) {
            throw new HttpError(`Fetch failed with status ${res.status}`, res.status);
          }

          const { text } = await readResponseTextWithLimit(res, max_content_bytes);
          return { status: res.status, headers: res.headers, text };
        } finally {
          clearTimeout(timeout);
        }
      }

      // Should be unreachable, but keeps TS happy.
      throw new Error('Too many redirects');
    },
    {
      maxRetries: fetch_max_retries,
      baseBackoffMs: fetch_retry_backoff_ms,
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
