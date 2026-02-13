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
import { waitForPoliteness } from './politeness.js';
import { assertRobotsAllowed } from './robots.js';
import { Actor } from 'apify';
import { Agent, ProxyAgent, type Dispatcher } from 'undici';
import type { Route } from 'playwright';
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

  // Playwright uses TimeoutError for navigation/wait failures.
  if (err instanceof Error && err.name === 'TimeoutError') return true;

  return false;
}

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

async function resolveProxyUrl(proxy_configuration: SentinelInput['proxy_configuration']): Promise<string | null> {
  if (!proxy_configuration) return null;

  if (proxy_configuration.proxy_urls && proxy_configuration.proxy_urls.length > 0) {
    return proxy_configuration.proxy_urls[0] ?? null;
  }

  if (proxy_configuration.use_apify_proxy) {
    const cfg = await Actor.createProxyConfiguration({
      useApifyProxy: true,
      apifyProxyGroups: proxy_configuration.apify_proxy_groups,
      apifyProxyCountry: proxy_configuration.apify_proxy_country,
    });
    if (!cfg) throw new Error('Proxy configuration requested but could not be created.');
    const next = await cfg.newUrl();
    if (!next) throw new Error('Proxy configuration did not produce a proxy URL.');
    return next;
  }

  return null;
}

function countRedirectsFromRequest(req: { redirectedFrom?: () => unknown | null } | null): number {
  let count = 0;
  let cur: unknown = req?.redirectedFrom?.() ?? null;
  while (cur) {
    count += 1;
    cur = (cur as { redirectedFrom?: () => unknown | null }).redirectedFrom?.() ?? null;
  }
  return count;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const want = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === want);
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

function stripHeader(headers: Record<string, string>, name: string): Record<string, string> {
  const want = name.toLowerCase();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) continue;
    out[k] = v;
  }
  return out;
}

function setHeaderIfAbsent(headers: Record<string, string>, name: string, value: string): void {
  if (!hasHeader(headers, name)) {
    headers[name] = value;
  }
}

function buildCookieHeader(cookies: SentinelInput['target_cookies']): string {
  // Minimal cookie header support for static fetch. Prefer Playwright context cookies for complex cases.
  return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

function compileUserRegex(pattern: string): RegExp {
  // Allow either:
  // - plain pattern: "foo\\d+" => /foo\d+/g
  // - slash form: "/foo\\d+/gi" => /foo\d+/gi (ensure global)
  const slashForm = pattern.match(/^\/(.+)\/([a-zA-Z]*)$/);
  if (slashForm) {
    const body = slashForm[1];
    const flagsRaw = slashForm[2] ?? '';
    if (!body) throw new Error(`Invalid regex: ${pattern}`);
    const flags = flagsRaw.includes('g') ? flagsRaw : `${flagsRaw}g`;
    return new RegExp(body, flags);
  }
  return new RegExp(pattern, 'g');
}

function matchesAnyRegex(text: string, patterns: string[]): string | null {
  for (const p of patterns) {
    let re: RegExp;
    try {
      re = compileUserRegex(p);
    } catch {
      // Invalid patterns should be a hard error for predictable behavior.
      throw new Error(`Invalid block_page_regex: ${p}`);
    }
    if (re.test(text)) return p;
  }
  return null;
}

function toPlaywrightProxy(proxyUrl: string): { server: string; username?: string; password?: string } {
  const u = new URL(proxyUrl);
  const out: { server: string; username?: string; password?: string } = { server: u.origin };
  if (u.username) out.username = u.username;
  if (u.password) out.password = u.password;
  return out;
}

export async function buildSnapshot(input: SentinelInput, previous: Snapshot | null = null): Promise<Snapshot> {
  if (input.rendering_mode === 'playwright') {
    const method = input.target_method.toUpperCase();
    if (method !== 'GET') {
      throw new Error(`rendering_mode=playwright currently only supports target_method=GET (got ${method})`);
    }
    if (typeof input.target_body === 'string' && input.target_body.length > 0) {
      throw new Error('rendering_mode=playwright does not support target_body (use static mode).');
    }
    return buildSnapshotPlaywright(input, previous);
  }

  const {
    fetch_max_retries,
    fetch_retry_backoff_ms,
    fetch_timeout_secs,
    fetch_connect_timeout_secs,
    target_url,
    selector,
    fetch_headers,
    target_method,
    target_body,
    target_cookies,
    robots_txt_mode,
    block_page_regexes,
    proxy_configuration,
    target_domain_allowlist,
    target_domain_denylist,
    ignore_selectors,
    ignore_attributes,
    ignore_regexes,
    max_redirects,
    max_content_bytes,
    politeness_delay_ms,
    politeness_jitter_ms,
    min_text_length,
    on_empty_snapshot,
    selector_aggregation_mode,
    whitespace_mode,
    unicode_normalization,
    fields,
    ignore_json_paths,
  } = input;

  const connectTimeoutMs = fetch_connect_timeout_secs * 1000;

  const proxyUrl = await resolveProxyUrl(proxy_configuration);

  const dispatcher: Dispatcher = proxyUrl
    ? new ProxyAgent({ uri: proxyUrl, connectTimeout: connectTimeoutMs })
    : new Agent({ connectTimeout: connectTimeoutMs });

  const method = target_method.toUpperCase();
  if ((method === 'GET' || method === 'HEAD') && typeof target_body === 'string' && target_body.length > 0) {
    throw new Error(`target_body is not allowed for target_method=${method}`);
  }

  const defaultUserAgent = 'SentinelWebhook/0.1 (+https://github.com/firasmosbehi/sentinel-webhook)';
  const userAgent = getHeader(fetch_headers, 'user-agent') ?? defaultUserAgent;
  const allowLocalhost = input.allow_localhost && !(Actor.getEnv().isAtHome ?? false);

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
        let currentMethod = method;
        let currentBody = typeof target_body === 'string' && target_body.length > 0 ? target_body : undefined;
        const conditionalUrl = previous?.finalUrl ?? target_url;
        for (let i = 0; i <= max_redirects; i++) {
          const redirectCount = i;
          assertUrlAllowedByDomainPolicy(currentUrl, 'target_url', {
            allowlist: target_domain_allowlist,
            denylist: target_domain_denylist,
          });
          await assertSafeHttpUrl(currentUrl, 'target_url', { allowLocalhost });

          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), fetch_timeout_secs * 1000);
          try {
            if (robots_txt_mode === 'respect') {
              await assertRobotsAllowed(currentUrl, userAgent, {
                dispatcher,
                timeoutSecs: Math.min(10, fetch_timeout_secs),
                allowOnError: true,
              });
            }

            await waitForPoliteness(currentUrl, politeness_delay_ms, politeness_jitter_ms);

            const headers = stripHeader(fetch_headers, 'user-agent');
            headers['user-agent'] = userAgent;
            setHeaderIfAbsent(headers, 'accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
            if (target_cookies.length > 0) {
              setHeaderIfAbsent(headers, 'cookie', buildCookieHeader(target_cookies));
            }

            if ((currentMethod === 'GET' || currentMethod === 'HEAD') && !currentBody && currentUrl === conditionalUrl) {
              if (previous?.etag) setHeaderIfAbsent(headers, 'if-none-match', previous.etag);
              if (previous?.lastModified) setHeaderIfAbsent(headers, 'if-modified-since', previous.lastModified);
            }

            const res = await fetch(currentUrl, {
              method: currentMethod,
              redirect: 'manual',
              signal: controller.signal,
              dispatcher,
              headers,
              body: currentBody,
            } as unknown as RequestInit);

            if (REDIRECT_STATUS_CODES.has(res.status)) {
              const loc = res.headers.get('location');
              if (!loc) throw new HttpError(`Redirect status ${res.status} missing Location header`, res.status);
              if (i === max_redirects) throw new HttpError(`Too many redirects (>${max_redirects})`, res.status);

              const nextUrl = normalizeHttpUrl(new URL(loc, currentUrl).toString());
              // Follow common browser behavior: convert POST-like requests to GET on 301/302/303.
              if (
                res.status === 303 ||
                ((res.status === 301 || res.status === 302) && currentMethod !== 'GET' && currentMethod !== 'HEAD')
              ) {
                currentMethod = 'GET';
                currentBody = undefined;
              }

              currentUrl = nextUrl;
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
  const ctLower = (contentType ?? previous?.contentType ?? '').toLowerCase();
  const looksJson = ctLower.includes('json');
  const looksXml = !looksJson && ctLower.includes('xml') && !ctLower.includes('html');

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
      xmlMode: looksXml,
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
        xmlMode: looksXml,
        selectorAggregationMode: selector_aggregation_mode,
        whitespaceMode: whitespace_mode,
        unicodeNormalization: unicode_normalization,
      });
    } catch (err) {
      if (err instanceof EmptySelectorMatchError) {
        extracted = { text: '', html: undefined };
      } else {
        throw err;
      }
    }
  }

  if (block_page_regexes.length > 0) {
    const matched = matchesAnyRegex(extracted.text, block_page_regexes) ?? (extracted.html ? matchesAnyRegex(extracted.html, block_page_regexes) : null);
    if (matched) {
      throw new Error(`Possible block/soft-ban page detected (matched block_page_regex: ${matched})`);
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

async function buildSnapshotPlaywright(input: SentinelInput, _previous: Snapshot | null = null): Promise<Snapshot> {
  const {
    fetch_max_retries,
    fetch_retry_backoff_ms,
    fetch_timeout_secs,
    target_url,
    selector,
    fetch_headers,
    target_cookies,
    playwright_block_resources,
    proxy_configuration,
    target_domain_allowlist,
    target_domain_denylist,
    max_content_bytes,
    politeness_delay_ms,
    politeness_jitter_ms,
    min_text_length,
    on_empty_snapshot,
    selector_aggregation_mode,
    whitespace_mode,
    unicode_normalization,
    fields,
    ignore_json_paths,
    ignore_selectors,
    ignore_attributes,
    ignore_regexes,
    wait_until,
    wait_for_selector,
    wait_for_selector_timeout_secs,
    robots_txt_mode,
    block_page_regexes,
  } = input;

  const allowLocalhost = input.allow_localhost && !(Actor.getEnv().isAtHome ?? false);

  const { chromium } = await import('playwright');

  // Navigation can still follow redirects; validate the initial URL up front.
  assertUrlAllowedByDomainPolicy(target_url, 'target_url', {
    allowlist: target_domain_allowlist,
    denylist: target_domain_denylist,
  });
  await assertSafeHttpUrl(target_url, 'target_url', { allowLocalhost });

  const proxyUrl = await resolveProxyUrl(proxy_configuration);
  const launchOpts: { headless: boolean; proxy?: { server: string; username?: string; password?: string } } = {
    headless: true,
  };
  if (proxyUrl) launchOpts.proxy = toPlaywrightProxy(proxyUrl);

  const startedAt = Date.now();
  let attempts = 0;
  let result: {
    status: number;
    headers: Record<string, string>;
    bodyText: string;
    bytesRead: number;
    finalUrl: string;
    redirectCount: number;
  };

  const browser = await chromium.launch(launchOpts);
  try {
    result = await withRetries(
      async (attempt) => {
        attempts = attempt + 1;

        const userAgent =
          getHeader(fetch_headers, 'user-agent') ?? 'SentinelWebhook/0.1 (+https://github.com/firasmosbehi/sentinel-webhook)';
        const extraHeaders = stripHeader(fetch_headers, 'user-agent');
        if (!hasHeader(extraHeaders, 'accept')) {
          extraHeaders.accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
        }

        const context = await browser.newContext({ userAgent, extraHTTPHeaders: extraHeaders });
        if (target_cookies.length > 0) {
          await context.addCookies(
            target_cookies.map((c) => ({
              name: c.name,
              value: c.value,
              url: c.domain ? undefined : target_url,
              domain: c.domain,
              path: c.path ?? '/',
              expires: c.expires,
              httpOnly: c.httpOnly,
              secure: c.secure,
              sameSite: c.sameSite,
            })),
          );
        }
        const page = await context.newPage();

	        try {
	          await page.route('**/*', async (route: Route) => {
	            const req = route.request();
	            const url = req.url();
	            const resourceType = req.resourceType();
	            if (playwright_block_resources && (resourceType === 'image' || resourceType === 'media' || resourceType === 'font')) {
	              await route.abort();
	              return;
	            }
	            if (!url.startsWith('http://') && !url.startsWith('https://')) {
	              await route.abort();
	              return;
	            }
            try {
              await assertSafeHttpUrl(url, 'playwright_request', { allowLocalhost });
            } catch {
              await route.abort();
              return;
            }
            await route.continue();
          });

          await waitForPoliteness(target_url, politeness_delay_ms, politeness_jitter_ms);

          if (robots_txt_mode === 'respect') {
            await assertRobotsAllowed(target_url, userAgent, { timeoutSecs: Math.min(10, fetch_timeout_secs), allowOnError: true });
          }

          const nav = await page.goto(target_url, { waitUntil: wait_until, timeout: fetch_timeout_secs * 1000 });
          if (!nav) throw new Error('Playwright navigation failed (no response).');

          const status = nav.status();
          if (status >= 400) throw new HttpError(`Fetch failed with status ${status}`, status);

          const finalUrl = normalizeHttpUrl(nav.url());
          assertUrlAllowedByDomainPolicy(finalUrl, 'target_url', {
            allowlist: target_domain_allowlist,
            denylist: target_domain_denylist,
          });
          await assertSafeHttpUrl(finalUrl, 'target_url', { allowLocalhost });
          if (robots_txt_mode === 'respect') {
            await assertRobotsAllowed(finalUrl, userAgent, { timeoutSecs: Math.min(10, fetch_timeout_secs), allowOnError: true });
          }

          const navHeaders = nav.headers();
          const contentType = navHeaders['content-type'];
          const ctLower = (contentType ?? '').toLowerCase();
          const looksJson = ctLower.includes('json');
          const looksXml = !looksJson && ctLower.includes('xml') && !ctLower.includes('html');

          const waitSel = wait_for_selector ?? selector;
          if (waitSel) {
            await page.waitForSelector(waitSel, { timeout: wait_for_selector_timeout_secs * 1000 });
          }

          const bodyText = looksJson || looksXml ? await nav.text() : await page.content();
          const bytesRead = Buffer.byteLength(bodyText, 'utf8');
          if (bytesRead > max_content_bytes) {
            throw new Error(`Response exceeds max_content_bytes (${bytesRead} > ${max_content_bytes})`);
          }

          const redirectCount = countRedirectsFromRequest(nav.request());

          return {
            status,
            headers: navHeaders,
            bodyText,
            bytesRead,
            finalUrl,
            redirectCount,
          };
        } finally {
          try {
            await context.close();
          } catch {
            // Ignore cleanup failures.
          }
        }
      },
      {
        maxRetries: fetch_max_retries,
        baseBackoffMs: fetch_retry_backoff_ms,
        shouldRetry: isRetryableFetchError,
      },
    );
  } finally {
    try {
      await browser.close();
    } catch {
      // Ignore cleanup failures.
    }
  }

  const fetchDurationMs = Date.now() - startedAt;
  const fetchedAt = new Date().toISOString();
  const contentType = result.headers['content-type'];
  const ctLower = (contentType ?? '').toLowerCase();
  const looksJson = ctLower.includes('json');
  const looksXml = !looksJson && ctLower.includes('xml') && !ctLower.includes('html');

  let mode: Snapshot['mode'] = 'text';
  let extracted: { text: string; html?: string };

  if (fields.length > 0) {
    mode = 'fields';
    const values = extractFieldsFromHtml(result.bodyText, fields, {
      ignoreSelectors: ignore_selectors,
      ignoreAttributes: ignore_attributes,
      ignoreRegexes: ignore_regexes,
      xmlMode: looksXml,
    });
    extracted = { text: stableStringifyJson(values) };
  } else if (looksJson) {
    mode = 'json';
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.bodyText);
    } catch {
      throw new Error('Failed to parse application/json response.');
    }
    const sanitized = ignore_json_paths.length > 0 ? removeJsonPointerPaths(parsed, ignore_json_paths) : parsed;
    extracted = { text: stableStringifyJson(sanitized) };
  } else {
    mode = 'text';
    try {
      extracted = normalizeHtmlToSnapshot(result.bodyText, {
        selector,
        ignoreSelectors: ignore_selectors,
        ignoreAttributes: ignore_attributes,
        ignoreRegexes: ignore_regexes,
        xmlMode: looksXml,
        selectorAggregationMode: selector_aggregation_mode,
        whitespaceMode: whitespace_mode,
        unicodeNormalization: unicode_normalization,
      });
    } catch (err) {
      if (err instanceof EmptySelectorMatchError) {
        extracted = { text: '', html: undefined };
      } else {
        throw err;
      }
    }
  }

  if (block_page_regexes.length > 0) {
    const matched = matchesAnyRegex(extracted.text, block_page_regexes) ?? (extracted.html ? matchesAnyRegex(extracted.html, block_page_regexes) : null);
    if (matched) {
      throw new Error(`Possible block/soft-ban page detected (matched block_page_regex: ${matched})`);
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
    statusCode: result.status,
    mode,
    finalUrl: result.finalUrl,
    redirectCount: result.redirectCount,
    bytesRead: result.bytesRead,
    fetchDurationMs,
    fetchAttempts: attempts,
    notModified: false,
    contentType,
    etag: result.headers.etag ?? undefined,
    lastModified: result.headers['last-modified'] ?? undefined,
    text: extracted.text,
    html: extracted.html,
    contentHash: sha256Hex(extracted.text),
  };
}
