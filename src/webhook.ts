import { withRetries } from './retry.js';
import { hmacSha256Hex } from './hash.js';
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
  if (err instanceof WebhookDeliveryError && typeof err.statusCode === 'number') {
    return err.statusCode === 429 || (err.statusCode >= 500 && err.statusCode <= 599);
  }
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

async function postJson(url: string, payload: unknown, headers: Record<string, string>, timeoutSecs: number): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutSecs * 1000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'follow',
      signal: controller.signal,
      headers,
      body: JSON.stringify(payload),
    });

    if (res.status < 200 || res.status >= 300) {
      const text = await res.text().catch(() => '');
      throw new WebhookDeliveryError(
        `Webhook responded with status ${res.status}${text ? `: ${text.slice(0, 500)}` : ''}`,
        res.status,
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendWebhook(input: SentinelInput, payload: ChangePayload): Promise<void> {
  const json = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    ...input.webhook_headers,
  };

  if (input.webhook_secret) {
    headers['x-sentinel-signature'] = `sha256=${hmacSha256Hex(input.webhook_secret, json)}`;
  }

  await withRetries(
    async () => postJson(input.webhook_url, payload, headers, input.timeout_secs),
    {
      maxRetries: input.max_retries,
      baseBackoffMs: input.retry_backoff_ms,
      shouldRetry: isRetryableWebhookError,
    },
  );
}

