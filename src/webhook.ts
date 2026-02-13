import { withRetries } from './retry.js';
import { hmacSha256Hex } from './hash.js';
import { readResponseTextWithLimit } from './http.js';
import { assertSafeHttpUrl } from './url_safety.js';
import { redactText, truncate } from './redact.js';
import { assertUrlAllowedByDomainPolicy } from './domain_policy.js';
import { Actor } from 'apify';
import type { SentinelInput, WebhookPayload } from './types.js';

export class WebhookDeliveryError extends Error {
  public readonly url?: string;
  public readonly statusCode?: number;
  public readonly attempts?: number;
  public readonly durationMs?: number;

  constructor(message: string, opts: { url?: string; statusCode?: number; attempts?: number; durationMs?: number } = {}) {
    super(message);
    this.name = 'WebhookDeliveryError';
    this.url = opts.url;
    this.statusCode = opts.statusCode;
    this.attempts = opts.attempts;
    this.durationMs = opts.durationMs;
  }
}

function isRetryableWebhookError(err: unknown): boolean {
  // Status-code based decisions are handled via a closure in sendWebhook so we can
  // apply user-provided retry policy.
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const want = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === want);
}

async function sendJson(
  url: string,
  bodyJson: string,
  headers: Record<string, string>,
  method: string,
  timeoutSecs: number,
  redactLogs: boolean,
): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSecs * 1000);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'manual',
      signal: controller.signal,
      headers,
      body: bodyJson,
    });

    if (res.status < 200 || res.status >= 300) {
      // Only read a small chunk for debugging; avoid logging huge bodies.
      let text = '';
      try {
        const read = await readResponseTextWithLimit(res, 4_096);
        text = read.text;
      } catch {
        // Ignore read failures.
      }

      if (redactLogs) text = redactText(text);
      const truncated = truncate(text, 500);
      throw new WebhookDeliveryError(
        `Webhook responded with status ${res.status}${truncated.text ? `: ${truncated.text}` : ''}`,
        { url, statusCode: res.status },
      );
    }

    return res.status;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWebhook(
  input: SentinelInput,
  payload: WebhookPayload,
): Promise<{ deliveries: Array<{ url: string; attempts: number; durationMs: number; statusCode: number }>; attempts: number; durationMs: number }> {
  const urls = input.webhook_urls.length > 0 ? input.webhook_urls : [input.webhook_url];
  if (urls.length === 0) throw new Error('No webhook URLs configured.');

  const allowLocalhost = input.allow_localhost && !(Actor.getEnv().isAtHome ?? false);
  for (const url of urls) {
    await assertSafeHttpUrl(url, 'webhook_url', { allowLocalhost });
    assertUrlAllowedByDomainPolicy(url, 'webhook_url', {
      allowlist: input.webhook_domain_allowlist,
      denylist: input.webhook_domain_denylist,
    });
  }

  const json = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const headers: Record<string, string> = { ...input.webhook_headers };
  if (!hasHeader(headers, 'content-type')) headers['content-type'] = input.webhook_content_type;
  headers['x-sentinel-event-id'] = payload.event_id;
  headers['idempotency-key'] = payload.event_id;
  headers['x-sentinel-timestamp'] = timestamp;

  if (input.webhook_secret) {
    headers['x-sentinel-signature'] = `sha256=${hmacSha256Hex(input.webhook_secret, `${timestamp}.${json}`)}`;
  }

  const retryStatusSet = new Set(input.webhook_retry_on_statuses);

  function shouldRetry(err: unknown): boolean {
    if (err instanceof WebhookDeliveryError && typeof err.statusCode === 'number') {
      if (retryStatusSet.has(err.statusCode)) return true;
      if (input.webhook_retry_on_5xx && err.statusCode >= 500 && err.statusCode <= 599) return true;
      return false;
    }
    return isRetryableWebhookError(err);
  }

  const deliveries: Array<{ url: string; attempts: number; durationMs: number; statusCode: number }> = [];
  const failures: WebhookDeliveryError[] = [];

  const startedAt = Date.now();
  for (const url of urls) {
    const startedUrlAt = Date.now();
    let attempts = 0;
    let statusCode = 0;
    try {
      await withRetries(
        async (attempt) => {
          attempts = attempt + 1;
          statusCode = await sendJson(url, json, headers, input.webhook_method, input.webhook_timeout_secs, input.redact_logs);
        },
        {
          maxRetries: input.webhook_max_retries,
          baseBackoffMs: input.webhook_retry_backoff_ms,
          maxTotalTimeMs:
            typeof input.webhook_max_retry_time_secs === 'number'
              ? Math.floor(input.webhook_max_retry_time_secs * 1000)
              : undefined,
          shouldRetry,
        },
      );

      deliveries.push({ url, attempts, durationMs: Date.now() - startedUrlAt, statusCode });
    } catch (err) {
      const durationMs = Date.now() - startedUrlAt;
      if (err instanceof WebhookDeliveryError) {
        failures.push(new WebhookDeliveryError(err.message, { url, statusCode: err.statusCode, attempts, durationMs }));
      } else {
        failures.push(new WebhookDeliveryError((err as Error)?.message ?? 'Webhook delivery failed', { url, attempts, durationMs }));
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const totalAttempts = deliveries.reduce((sum, d) => sum + d.attempts, 0) + failures.reduce((sum, f) => sum + (f.attempts ?? 0), 0);

  const success = deliveries.length > 0;
  const ok = input.webhook_delivery_mode === 'any' ? success : failures.length === 0;
  if (!ok) {
    const first = failures[0];
    throw new WebhookDeliveryError(first?.message ?? 'Webhook delivery failed', {
      url: first?.url,
      statusCode: first?.statusCode,
      attempts: totalAttempts,
      durationMs,
    });
  }

  return { deliveries, attempts: totalAttempts, durationMs };
}
