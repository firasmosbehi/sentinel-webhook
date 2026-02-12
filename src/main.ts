import { Actor, log } from 'apify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseInput } from './input.js';
import { buildSnapshot } from './snapshot.js';
import { computeTextChange } from './diff.js';
import { makeStateKey } from './state.js';
import { sendWebhook, WebhookDeliveryError } from './webhook.js';
import { assertSafeHttpUrl } from './url_safety.js';
import { redactText, redactUrl, truncate } from './redact.js';
import type { ChangePayload, Snapshot } from './types.js';

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('Unknown error');
  }
}

async function loadFallbackInput(): Promise<unknown | null> {
  const env = process.env.SENTINEL_INPUT;
  if (env) return JSON.parse(env);

  if (existsSync('INPUT.json')) {
    const raw = await readFile('INPUT.json', 'utf8');
    return JSON.parse(raw);
  }

  return null;
}

function safeUrl(rawUrl: string, redact: boolean): string {
  return redact ? redactUrl(rawUrl) : rawUrl;
}

function toSafeError(err: unknown, redact: boolean): { name: string; message: string; statusCode?: number } {
  const statusCode = err instanceof WebhookDeliveryError ? err.statusCode : undefined;
  const e = toError(err);
  const message = redact ? redactText(e.message) : e.message;
  return { name: e.name, message, statusCode };
}

function buildDeadLetterPayloadPreview(payload: ChangePayload, redact: boolean): { payload: ChangePayload; truncated: boolean } {
  const out: ChangePayload = {
    ...payload,
    url: safeUrl(payload.url, redact),
  };

  if (!payload.changes) return { payload: out, truncated: false };

  const oldT = truncate(payload.changes.text.old, 5_000);
  const newT = truncate(payload.changes.text.new, 5_000);
  return {
    payload: {
      ...out,
      changes: {
        text: {
          ...payload.changes.text,
          old: oldT.text,
          new: newT.text,
        },
      },
    },
    truncated: oldT.truncated || newT.truncated,
  };
}

await Actor.main(async () => {
  const raw = (await Actor.getInput()) ?? (await loadFallbackInput());
  if (raw == null) {
    throw new Error(
      'Missing input. Provide Apify Actor input or create INPUT.json in the project root or set SENTINEL_INPUT.',
    );
  }
  const input = parseInput(raw);
  log.setLevel(input.debug ? log.LEVELS.DEBUG : log.LEVELS.INFO);

  // Fail fast on unsafe URLs (SSRF protection).
  await assertSafeHttpUrl(input.target_url, 'target_url');
  await assertSafeHttpUrl(input.webhook_url, 'webhook_url');

  const kv = await Actor.openKeyValueStore(input.state_store_name);
  const stateKey = makeStateKey(input.target_url, input.selector);

  const previous = (await kv.getValue<Snapshot>(stateKey)) ?? null;

  let current: Snapshot;
  try {
    current = await buildSnapshot(input);
  } catch (err) {
    log.exception(toError(err), 'Failed to fetch/extract snapshot. Keeping previous baseline intact.');
    await Actor.pushData({
      event: 'FETCH_FAILED',
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      timestamp: new Date().toISOString(),
      stateKey,
    });
    return;
  }

  if (!previous) {
    await kv.setValue(stateKey, current);
    log.info('Baseline stored (no previous snapshot).', { stateKey, contentHash: current.contentHash });

    const payload: ChangePayload = {
      schema_version: 1,
      event: 'BASELINE_STORED',
      url: input.target_url,
      selector: input.selector,
      timestamp: new Date().toISOString(),
      current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
    };

    await Actor.pushData({
      ...payload,
      url: safeUrl(payload.url, input.redact_logs),
      stateKey,
    });

    if (input.baseline_mode === 'notify') {
      try {
        const delivery = await sendWebhook(input, payload);
        log.info('Baseline webhook sent.', { webhook_url: safeUrl(input.webhook_url, input.redact_logs), ...delivery });
      } catch (err) {
        const safeErr = toSafeError(err, input.redact_logs);
        const preview = buildDeadLetterPayloadPreview(payload, input.redact_logs);
        const dead = await Actor.openDataset(input.dead_letter_dataset_name);
        await dead.pushData({
          event: 'WEBHOOK_DELIVERY_FAILED',
          timestamp: new Date().toISOString(),
          stateKey,
          webhook_url: safeUrl(input.webhook_url, input.redact_logs),
          target_url: safeUrl(input.target_url, input.redact_logs),
          selector: input.selector,
          error: safeErr,
          payload: preview.payload,
          payload_truncated: preview.truncated,
        });

        await Actor.pushData({
          event: 'WEBHOOK_FAILED',
          timestamp: new Date().toISOString(),
          stateKey,
          webhook_url: safeUrl(input.webhook_url, input.redact_logs),
          target_url: safeUrl(input.target_url, input.redact_logs),
          selector: input.selector,
          error: safeErr,
        });

        log.error('Baseline webhook delivery failed (stored in dead-letter dataset).', {
          webhook_url: safeUrl(input.webhook_url, input.redact_logs),
          dead_letter_dataset_name: input.dead_letter_dataset_name,
          error: safeErr,
        });
      }
    }

    return;
  }

  const change = computeTextChange(previous, current);
  if (!change) {
    log.info('No change detected.', { stateKey, contentHash: current.contentHash });
    await Actor.pushData({
      event: 'NO_CHANGE',
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      timestamp: new Date().toISOString(),
      previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
      current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
      stateKey,
    });

    // Refresh baseline metadata (timestamps/headers) even if content is unchanged.
    await kv.setValue(stateKey, current);
    return;
  }

  const payload: ChangePayload = {
    schema_version: 1,
    event: 'CHANGE_DETECTED',
    url: input.target_url,
    selector: input.selector,
    timestamp: new Date().toISOString(),
    changes: { text: change },
    previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
    current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
  };

  try {
    const delivery = await sendWebhook(input, payload);
    log.info('Change detected; webhook delivered.', { webhook_url: safeUrl(input.webhook_url, input.redact_logs), ...delivery });
  } catch (err) {
    const safeErr = toSafeError(err, input.redact_logs);
    const preview = buildDeadLetterPayloadPreview(payload, input.redact_logs);
    const dead = await Actor.openDataset(input.dead_letter_dataset_name);
    await dead.pushData({
      event: 'WEBHOOK_DELIVERY_FAILED',
      timestamp: new Date().toISOString(),
      stateKey,
      webhook_url: safeUrl(input.webhook_url, input.redact_logs),
      target_url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      error: safeErr,
      payload: preview.payload,
      payload_truncated: preview.truncated,
    });

    await Actor.pushData({
      event: 'WEBHOOK_FAILED',
      timestamp: new Date().toISOString(),
      stateKey,
      webhook_url: safeUrl(input.webhook_url, input.redact_logs),
      target_url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      error: safeErr,
    });

    log.error('Change detected but webhook delivery failed. Baseline NOT updated (will retry next run).', {
      webhook_url: safeUrl(input.webhook_url, input.redact_logs),
      dead_letter_dataset_name: input.dead_letter_dataset_name,
      error: safeErr,
    });

    return;
  }

  await kv.setValue(stateKey, current);
  await Actor.pushData({
    ...payload,
    url: safeUrl(payload.url, input.redact_logs),
    stateKey,
  });
});
