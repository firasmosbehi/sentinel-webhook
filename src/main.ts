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
import { computeEventId } from './event_id.js';
import { limitPayloadBytes } from './payload_limit.js';
import { assertUrlAllowedByDomainPolicy } from './domain_policy.js';
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
  assertUrlAllowedByDomainPolicy(input.target_url, 'target_url', {
    allowlist: input.target_domain_allowlist,
    denylist: input.target_domain_denylist,
  });
  assertUrlAllowedByDomainPolicy(input.webhook_url, 'webhook_url', {
    allowlist: input.webhook_domain_allowlist,
    denylist: input.webhook_domain_denylist,
  });

  const kv = await Actor.openKeyValueStore(input.state_store_name);
  const stateKey = makeStateKey(input.target_url, input.selector);

  const storedPrevious = (await kv.getValue<Snapshot>(stateKey)) ?? null;
  const previous = input.reset_baseline ? null : storedPrevious;

  const history = input.history_mode === 'none' ? null : await Actor.openDataset(input.history_dataset_name);

  async function pushHistory(item: Record<string, unknown>): Promise<void> {
    if (!history) return;
    if (input.history_mode === 'changes_only' && item.event !== 'CHANGE_DETECTED') return;
    await history.pushData(item);
  }

  if (input.reset_baseline && storedPrevious) {
    log.info('Reset baseline requested; ignoring existing baseline.', { stateKey, contentHash: storedPrevious.contentHash });
    await Actor.pushData({
      event: 'BASELINE_RESET',
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      timestamp: new Date().toISOString(),
      stateKey,
      previous: { contentHash: storedPrevious.contentHash, fetchedAt: storedPrevious.fetchedAt },
    });

    await pushHistory({
      event: 'BASELINE_RESET',
      timestamp: new Date().toISOString(),
      stateKey,
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      previous: { contentHash: storedPrevious.contentHash, fetchedAt: storedPrevious.fetchedAt },
    });
  }

  let current: Snapshot;
  try {
    current = await buildSnapshot(input, previous);
  } catch (err) {
    log.exception(toError(err), 'Failed to fetch/extract snapshot. Keeping previous baseline intact.');
    await Actor.pushData({
      event: 'FETCH_FAILED',
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      timestamp: new Date().toISOString(),
      stateKey,
    });

    if (input.history_mode === 'all_events') {
      await pushHistory({
        event: 'FETCH_FAILED',
        timestamp: new Date().toISOString(),
        stateKey,
        url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
      });
    }
    return;
  }

  if (!previous) {
    await kv.setValue(stateKey, current);
    log.info('Baseline stored (no previous snapshot).', { stateKey, contentHash: current.contentHash });

    const payloadBase: ChangePayload = {
      schema_version: 1,
      event_id: computeEventId({
        event: 'BASELINE_STORED',
        url: input.target_url,
        selector: input.selector,
        currentHash: current.contentHash,
      }),
      event: 'BASELINE_STORED',
      url: input.target_url,
      selector: input.selector,
      timestamp: new Date().toISOString(),
      current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
    };

    const { payload } = limitPayloadBytes(payloadBase, input.max_payload_bytes);

    await Actor.pushData({
      ...payload,
      url: safeUrl(payload.url, input.redact_logs),
      stateKey,
    });

    if (input.baseline_mode === 'notify') {
      try {
        const delivery = await sendWebhook(input, payload);
        log.info('Baseline webhook sent.', { webhook_url: safeUrl(input.webhook_url, input.redact_logs), ...delivery });

        await pushHistory({
          event: 'BASELINE_STORED',
          timestamp: payload.timestamp,
          event_id: payload.event_id,
          stateKey,
          url: safeUrl(payload.url, input.redact_logs),
          selector: payload.selector,
          payload: { ...payload, url: safeUrl(payload.url, input.redact_logs) },
          webhook_url: safeUrl(input.webhook_url, input.redact_logs),
          delivered: true,
          delivery,
        });
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

        await pushHistory({
          event: 'BASELINE_STORED',
          timestamp: payload.timestamp,
          event_id: payload.event_id,
          stateKey,
          url: safeUrl(payload.url, input.redact_logs),
          selector: payload.selector,
          payload: { ...payload, url: safeUrl(payload.url, input.redact_logs) },
          webhook_url: safeUrl(input.webhook_url, input.redact_logs),
          delivered: false,
          error: safeErr,
        });
      }
    } else if (input.history_mode === 'all_events') {
      await pushHistory({
        event: 'BASELINE_STORED',
        timestamp: payload.timestamp,
        event_id: payload.event_id,
        stateKey,
        url: safeUrl(payload.url, input.redact_logs),
        selector: payload.selector,
        payload: { ...payload, url: safeUrl(payload.url, input.redact_logs) },
        webhook_url: safeUrl(input.webhook_url, input.redact_logs),
        delivered: false,
        webhook_skipped: true,
      });
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

    if (input.history_mode === 'all_events') {
      await pushHistory({
        event: 'NO_CHANGE',
        timestamp: new Date().toISOString(),
        stateKey,
        url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
        previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
        current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
      });
    }

    // Refresh baseline metadata (timestamps/headers) even if content is unchanged.
    await kv.setValue(stateKey, current);
    return;
  }

  const payloadBase: ChangePayload = {
    schema_version: 1,
    event_id: computeEventId({
      event: 'CHANGE_DETECTED',
      url: input.target_url,
      selector: input.selector,
      previousHash: previous.contentHash,
      currentHash: current.contentHash,
    }),
    event: 'CHANGE_DETECTED',
    url: input.target_url,
    selector: input.selector,
    timestamp: new Date().toISOString(),
    changes: { text: change },
    previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
    current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
  };

  const { payload } = limitPayloadBytes(payloadBase, input.max_payload_bytes);

  try {
    const delivery = await sendWebhook(input, payload);
    log.info('Change detected; webhook delivered.', { webhook_url: safeUrl(input.webhook_url, input.redact_logs), ...delivery });

    await pushHistory({
      event: 'CHANGE_DETECTED',
      timestamp: payload.timestamp,
      event_id: payload.event_id,
      stateKey,
      url: safeUrl(payload.url, input.redact_logs),
      selector: payload.selector,
      payload: { ...payload, url: safeUrl(payload.url, input.redact_logs) },
      webhook_url: safeUrl(input.webhook_url, input.redact_logs),
      delivered: true,
      delivery,
    });
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

    await pushHistory({
      event: 'CHANGE_DETECTED',
      timestamp: payload.timestamp,
      event_id: payload.event_id,
      stateKey,
      url: safeUrl(payload.url, input.redact_logs),
      selector: payload.selector,
      payload: { ...payload, url: safeUrl(payload.url, input.redact_logs) },
      webhook_url: safeUrl(input.webhook_url, input.redact_logs),
      delivered: false,
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
