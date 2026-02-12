import { withRetries } from './retry.js';
import { hmacSha256Hex } from './hash.js';
import { readResponseTextWithLimit } from './http.js';
import { assertSafeHttpUrl } from './url_safety.js';
import { redactText, truncate } from './redact.js';
import type { SentinelInput, ChangePayload } from './types.js';

export class WebhookDeliveryError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'WebhookDeliveryError';
    this.statusCode = statusCode;
  }
}

function isRetryableWebhookError(err: unknown): boolean {
  // Status-code based decisions are handled via a closure in sendWebhook so we can
  // apply user-provided retry policy.
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

async function postJson(
  url: string,
  bodyJson: string,
  headers: Record<string, string>,
  timeoutSecs: number,
  redactLogs: boolean,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSecs * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
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
        res.status,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWebhook(input: SentinelInput, payload: ChangePayload): Promise<{ attempts: number }> {
  await assertSafeHttpUrl(input.webhook_url, 'webhook_url');

  const json = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    ...input.webhook_headers,
    'x-sentinel-event-id': payload.event_id,
    'idempotency-key': payload.event_id,
  };

  if (input.webhook_secret) {
    headers['x-sentinel-signature'] = `sha256=${hmacSha256Hex(input.webhook_secret, json)}`;
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

  let attempts = 0;
  await withRetries(
    async (attempt) => {
      attempts = attempt + 1;
      return postJson(input.webhook_url, json, headers, input.webhook_timeout_secs, input.redact_logs);
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

  return { attempts };
}
