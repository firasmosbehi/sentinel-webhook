import { withRetries } from './retry.js';
import { sha256Hex } from './hash.js';
import { EmptySelectorMatchError, normalizeHtmlToSnapshot } from './normalize.js';
import { extractFieldsFromHtml } from './fields_extract.js';
import { readResponseTextWithLimit } from './http.js';
import { removeJsonPointerPaths } from './json_paths.js';
import { stableStringifyJson } from './stable_json.js';
import { assertSafeHttpUrl } from './url_safety.js';
import { assertUrlAllowedByDomainPolicy } from './domain_policy.js';
import { normalizeHttpUrl } from './url_normalize.js';
import { Actor } from 'apify';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { SentinelInput, Snapshot } from './types.js';

export class HttpError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export class EmptySnapshotError extends Error {
  public readonly textLength: number;
  public readonly minTextLength: number;
  public readonly ignored: boolean;

  constructor(message: string, textLength: number, minTextLength: number, ignored: boolean) {
    super(message);
    this.name = 'EmptySnapshotError';
    this.textLength = textLength;
    this.minTextLength = minTextLength;
    this.ignored = ignored;
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

export async function buildSnapshot(input: SentinelInput, previous: Snapshot | null = null): Promise<Snapshot> {
  if (input.rendering_mode !== 'static') {
    throw new Error(`rendering_mode=${input.rendering_mode} is not implemented yet`);
  }

  const {
    fetch_max_retries,
    fetch_retry_backoff_ms,
    fetch_timeout_secs,
    fetch_connect_timeout_secs,
    target_url,
    selector,
    fetch_headers,
    proxy_configuration,
    target_domain_allowlist,
    target_domain_denylist,
    ignore_selectors,
    ignore_attributes,
    ignore_regexes,
    max_redirects,
    max_content_bytes,
    min_text_length,
    on_empty_snapshot,
    fields,
    ignore_json_paths,
  } = input;

  const connectTimeoutMs = fetch_connect_timeout_secs * 1000;

  let proxyUrl: string | null = null;
  if (proxy_configuration?.proxy_urls && proxy_configuration.proxy_urls.length > 0) {
    proxyUrl = proxy_configuration.proxy_urls[0] ?? null;
  } else if (proxy_configuration?.use_apify_proxy) {
    const cfg = await Actor.createProxyConfiguration({
      useApifyProxy: true,
      apifyProxyGroups: proxy_configuration.apify_proxy_groups,
      apifyProxyCountry: proxy_configuration.apify_proxy_country,
    });
    if (!cfg) throw new Error('Proxy configuration requested but could not be created.');
    const next = await cfg.newUrl();
    if (!next) throw new Error('Proxy configuration did not produce a proxy URL.');
    proxyUrl = next;
  }

  const dispatcher: Dispatcher = proxyUrl
    ? new ProxyAgent({ uri: proxyUrl, connectTimeout: connectTimeoutMs })
    : new Agent({ connectTimeout: connectTimeoutMs });

  const startedAt = Date.now();
  let attempts = 0;
  let result: {
    status: number;
    headers: Headers;
    text: string;
    notModified: boolean;
    bytesRead: number;
    finalUrl: string;
    redirectCount: number;
  };
  try {
    result = await withRetries(
      async (attempt) => {
        attempts = attempt + 1;
        let currentUrl = target_url;
        for (let i = 0; i <= max_redirects; i++) {
          const redirectCount = i;
          assertUrlAllowedByDomainPolicy(currentUrl, 'target_url', {
            allowlist: target_domain_allowlist,
            denylist: target_domain_denylist,
          });
          await assertSafeHttpUrl(currentUrl, 'target_url');

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), fetch_timeout_secs * 1000);
          try {
            const res = await fetch(currentUrl, {
              method: 'GET',
              redirect: 'manual',
              signal: controller.signal,
              dispatcher,
              headers: {
                'user-agent': 'SentinelWebhook/0.1 (+https://github.com/firasmosbehi/sentinel-webhook)',
                accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...(previous?.etag ? { 'if-none-match': previous.etag } : {}),
                ...(previous?.lastModified ? { 'if-modified-since': previous.lastModified } : {}),
                ...fetch_headers,
              },
            } as unknown as RequestInit);

            if (REDIRECT_STATUS_CODES.has(res.status)) {
              const loc = res.headers.get('location');
              if (!loc) throw new HttpError(`Redirect status ${res.status} missing Location header`, res.status);
              if (i === max_redirects) throw new HttpError(`Too many redirects (>${max_redirects})`, res.status);
              currentUrl = normalizeHttpUrl(new URL(loc, currentUrl).toString());
              continue;
            }

            if (res.status === 304) {
              if (!previous) throw new HttpError('Received 304 Not Modified but no previous snapshot exists', res.status);
              return {
                status: res.status,
                headers: res.headers,
                text: '',
                notModified: true,
                bytesRead: 0,
                finalUrl: currentUrl,
                redirectCount,
              };
            }

            if (res.status >= 400) {
              throw new HttpError(`Fetch failed with status ${res.status}`, res.status);
            }

            const { text, bytesRead } = await readResponseTextWithLimit(res, max_content_bytes);
            return {
              status: res.status,
              headers: res.headers,
              text,
              notModified: false,
              bytesRead,
              finalUrl: currentUrl,
              redirectCount,
            };
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
  } finally {
    try {
      await dispatcher.close();
    } catch {
      // Ignore dispatcher cleanup failures.
    }
  }

  const { status, headers, text: html, notModified, bytesRead, finalUrl, redirectCount } = result;
  const fetchDurationMs = Date.now() - startedAt;
  const contentType = headers.get('content-type') ?? undefined;
  const looksJson = (contentType ?? previous?.contentType ?? '').toLowerCase().includes('json');

  const fetchedAt = new Date().toISOString();

  if (notModified) {
    if (!previous) throw new Error('Received 304 Not Modified but no previous snapshot exists');
    return {
      url: target_url,
      selector,
      fetchedAt,
      statusCode: status,
      mode: previous.mode ?? (fields.length > 0 ? 'fields' : looksJson ? 'json' : 'text'),
      finalUrl,
      redirectCount,
      bytesRead,
      fetchDurationMs,
      fetchAttempts: attempts,
      notModified: true,
      contentType: contentType ?? previous.contentType,
      etag: headers.get('etag') ?? previous.etag,
      lastModified: headers.get('last-modified') ?? previous.lastModified,
      text: previous.text,
      html: previous.html,
      contentHash: previous.contentHash,
    };
  }

  let mode: Snapshot['mode'] = 'text';
  let extracted: { text: string; html?: string };

  if (fields.length > 0) {
    mode = 'fields';
    const values = extractFieldsFromHtml(html, fields, {
      ignoreSelectors: ignore_selectors,
      ignoreAttributes: ignore_attributes,
      ignoreRegexes: ignore_regexes,
    });
    extracted = { text: stableStringifyJson(values) };
  } else if (looksJson) {
    mode = 'json';
    let parsed: unknown;
    try {
      parsed = JSON.parse(html);
    } catch {
      throw new Error('Failed to parse application/json response.');
    }
    const sanitized = ignore_json_paths.length > 0 ? removeJsonPointerPaths(parsed, ignore_json_paths) : parsed;
    extracted = { text: stableStringifyJson(sanitized) };
  } else {
    mode = 'text';
    try {
      extracted = normalizeHtmlToSnapshot(html, {
        selector,
        ignoreSelectors: ignore_selectors,
        ignoreAttributes: ignore_attributes,
        ignoreRegexes: ignore_regexes,
      });
    } catch (err) {
      if (err instanceof EmptySelectorMatchError) {
        extracted = { text: '', html: undefined };
      } else {
        throw err;
      }
    }
  }

  const textLen = extracted.text.length;
  if (textLen === 0 || textLen < min_text_length) {
    const msg = `Empty snapshot (text length ${textLen}, min_text_length ${min_text_length})`;
    if (on_empty_snapshot === 'ignore') {
      throw new EmptySnapshotError(msg, textLen, min_text_length, true);
    }
    if (on_empty_snapshot === 'error') {
      throw new EmptySnapshotError(msg, textLen, min_text_length, false);
    }
    // treat_as_change: continue
  }

  return {
    url: target_url,
    selector,
    fetchedAt,
    statusCode: status,
    mode,
    finalUrl,
    redirectCount,
    bytesRead,
    fetchDurationMs,
    fetchAttempts: attempts,
    notModified: false,
    contentType,
    etag: headers.get('etag') ?? undefined,
    lastModified: headers.get('last-modified') ?? undefined,
    text: extracted.text,
    html: extracted.html,
    contentHash: sha256Hex(extracted.text),
  };
}
