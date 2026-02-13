import { Actor, log } from 'apify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseInput } from './input.js';
import { buildSnapshot, EmptySnapshotError } from './snapshot.js';
import { approxChangeRatio, computeTextChange } from './diff.js';
import { diffJson } from './json_diff.js';
import { makeStateKeyV1, makeStateKeyV2 } from './state.js';
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

function extractFirstNumber(text: string): number | null {
  const m = text.match(/-?\\d+(?:\\.\\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function computeShortTextDelta(oldText: string, newText: string): number | undefined {
  if (oldText.length > 64 || newText.length > 64) return undefined;
  const prevNum = extractFirstNumber(oldText);
  const currNum = extractFirstNumber(newText);
  if (prevNum === null || currNum === null) return undefined;
  return currNum - prevNum;
}

function computeFieldsChangeFromSnapshotText(
  previousText: string,
  currentText: string,
): Record<string, { old: string; new: string; delta?: number }> | null {
  let prev: unknown;
  let curr: unknown;
  try {
    prev = JSON.parse(previousText);
    curr = JSON.parse(currentText);
  } catch {
    return null;
  }

  if (!prev || typeof prev !== 'object' || Array.isArray(prev)) return null;
  if (!curr || typeof curr !== 'object' || Array.isArray(curr)) return null;

  const prevRec = prev as Record<string, unknown>;
  const currRec = curr as Record<string, unknown>;

  const keys = new Set([...Object.keys(prevRec), ...Object.keys(currRec)]);
  const out: Record<string, { old: string; new: string; delta?: number }> = {};
  for (const k of [...keys].sort()) {
    const oldVal = prevRec[k];
    const newVal = currRec[k];

    const oldText = typeof oldVal === 'string' ? oldVal : JSON.stringify(oldVal);
    const newText = typeof newVal === 'string' ? newVal : JSON.stringify(newVal);
    if (oldText === newText) continue;

    const delta = computeShortTextDelta(oldText, newText);
    out[k] = delta !== undefined ? { old: oldText, new: newText, delta } : { old: oldText, new: newText };
  }

  return Object.keys(out).length > 0 ? out : null;
}

function computeJsonChangeFromSnapshotText(
  previousText: string,
  currentText: string,
  ignoreJsonPaths: string[],
): { diffs: ReturnType<typeof diffJson> } | null {
  let prev: unknown;
  let curr: unknown;
  try {
    prev = JSON.parse(previousText);
    curr = JSON.parse(currentText);
  } catch {
    return null;
  }

  const diffs = diffJson(prev, curr, ignoreJsonPaths);
  return diffs.length > 0 ? { diffs } : null;
}

function snapshotFetchMetrics(snapshot: Snapshot, redact: boolean): {
  statusCode: number;
  finalUrl?: string;
  redirectCount?: number;
  bytesRead?: number;
  durationMs?: number;
  attempts?: number;
  notModified?: boolean;
} {
  return {
    statusCode: snapshot.statusCode,
    finalUrl: snapshot.finalUrl ? safeUrl(snapshot.finalUrl, redact) : undefined,
    redirectCount: snapshot.redirectCount,
    bytesRead: snapshot.bytesRead,
    durationMs: snapshot.fetchDurationMs,
    attempts: snapshot.fetchAttempts,
    notModified: snapshot.notModified,
  };
}

function toSafeError(
  err: unknown,
  redact: boolean,
): { name: string; message: string; statusCode?: number; attempts?: number; durationMs?: number } {
  const statusCode = err instanceof WebhookDeliveryError ? err.statusCode : undefined;
  const attempts = err instanceof WebhookDeliveryError ? err.attempts : undefined;
  const durationMs = err instanceof WebhookDeliveryError ? err.durationMs : undefined;
  const e = toError(err);
  const message = redact ? redactText(e.message) : e.message;
  return { name: e.name, message, statusCode, attempts, durationMs };
}

function buildDeadLetterPayloadPreview(payload: ChangePayload, redact: boolean): { payload: ChangePayload; truncated: boolean } {
  const out: ChangePayload = {
    ...payload,
    url: safeUrl(payload.url, redact),
  };

  const textChange = payload.changes?.text;
  if (!textChange) return { payload: out, truncated: false };

  const oldT = truncate(textChange.old, 5_000);
  const newT = truncate(textChange.new, 5_000);
  return {
    payload: {
      ...out,
      changes: {
        ...payload.changes,
        text: {
          ...textChange,
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
  const stateKeyV2 = makeStateKeyV2({
    targetUrl: input.target_url,
    selector: input.selector,
    renderingMode: input.rendering_mode,
    fetchHeaders: input.fetch_headers,
    fields: input.fields,
    ignoreJsonPaths: input.ignore_json_paths,
    ignoreSelectors: input.ignore_selectors,
    ignoreAttributes: input.ignore_attributes,
    ignoreRegexes: input.ignore_regexes,
  });
  const stateKeyV1 = makeStateKeyV1(input.target_url, input.selector);
  const stateKey = stateKeyV2;

  const storedPreviousV2 = (await kv.getValue<Snapshot>(stateKeyV2)) ?? null;
  const storedPreviousV1 = storedPreviousV2 ? null : ((await kv.getValue<Snapshot>(stateKeyV1)) ?? null);
  const storedPrevious = storedPreviousV2 ?? storedPreviousV1;
  const migratedFromV1 = !!storedPreviousV1;
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

  if (migratedFromV1) {
    log.info('Loaded baseline from legacy state key; will migrate to v2 on successful write.', { stateKeyV1, stateKeyV2 });
    await Actor.pushData({
      event: 'BASELINE_MIGRATED',
      timestamp: new Date().toISOString(),
      stateKeyV1,
      stateKeyV2,
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      previous: storedPrevious ? { contentHash: storedPrevious.contentHash, fetchedAt: storedPrevious.fetchedAt } : null,
    });
  }

  let current: Snapshot;
  try {
    current = await buildSnapshot(input, previous);
  } catch (err) {
    const e = toError(err);
    const timestamp = new Date().toISOString();
    const isEmpty = err instanceof EmptySnapshotError;

    if (isEmpty && err.ignored) {
      log.info('Empty snapshot ignored. Keeping previous baseline intact.', {
        stateKey,
        textLength: err.textLength,
        minTextLength: err.minTextLength,
      });
      await Actor.pushData({
        event: 'EMPTY_SNAPSHOT_IGNORED',
        url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
        timestamp,
        stateKey,
        textLength: err.textLength,
        minTextLength: err.minTextLength,
      });

      if (input.history_mode === 'all_events') {
        await pushHistory({
          event: 'EMPTY_SNAPSHOT_IGNORED',
          timestamp,
          stateKey,
          url: safeUrl(input.target_url, input.redact_logs),
          selector: input.selector,
          textLength: err.textLength,
          minTextLength: err.minTextLength,
        });
      }
      return;
    }

    log.exception(e, 'Failed to fetch/extract snapshot. Keeping previous baseline intact.');
    await Actor.pushData({
      event: isEmpty ? 'EMPTY_SNAPSHOT_ERROR' : 'FETCH_FAILED',
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      timestamp,
      stateKey,
      error: isEmpty ? { name: e.name, message: input.redact_logs ? redactText(e.message) : e.message } : undefined,
      textLength: isEmpty ? err.textLength : undefined,
      minTextLength: isEmpty ? err.minTextLength : undefined,
    });

    if (input.history_mode === 'all_events') {
      await pushHistory({
        event: isEmpty ? 'EMPTY_SNAPSHOT_ERROR' : 'FETCH_FAILED',
        timestamp,
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
      fetch: snapshotFetchMetrics(current, input.redact_logs),
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
          fetch: snapshotFetchMetrics(current, input.redact_logs),
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
          fetch: snapshotFetchMetrics(current, input.redact_logs),
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
          fetch: snapshotFetchMetrics(current, input.redact_logs),
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
          fetch: snapshotFetchMetrics(current, input.redact_logs),
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
        fetch: snapshotFetchMetrics(current, input.redact_logs),
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
      fetch: snapshotFetchMetrics(current, input.redact_logs),
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
        fetch: snapshotFetchMetrics(current, input.redact_logs),
      });
    }

    // Refresh baseline metadata (timestamps/headers) even if content is unchanged.
    await kv.setValue(stateKey, current);
    return;
  }

  if (input.min_change_ratio > 0) {
    const ratio = approxChangeRatio(change.old, change.new);
    if (ratio < input.min_change_ratio) {
      log.info('Change suppressed (below min_change_ratio).', { stateKey, ratio, min_change_ratio: input.min_change_ratio });
      await Actor.pushData({
        event: 'CHANGE_SUPPRESSED',
        url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
        timestamp: new Date().toISOString(),
        ratio,
        min_change_ratio: input.min_change_ratio,
        previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
        current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
        fetch: snapshotFetchMetrics(current, input.redact_logs),
        stateKey,
      });

      if (input.history_mode === 'all_events') {
        await pushHistory({
          event: 'CHANGE_SUPPRESSED',
          timestamp: new Date().toISOString(),
          stateKey,
          url: safeUrl(input.target_url, input.redact_logs),
          selector: input.selector,
          ratio,
          min_change_ratio: input.min_change_ratio,
          previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
          current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
          fetch: snapshotFetchMetrics(current, input.redact_logs),
        });
      }

      // Suppress alert but still advance baseline to avoid repeated detections.
      await kv.setValue(stateKey, current);
      return;
    }
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
    changes: (() => {
      const out: NonNullable<ChangePayload['changes']> = { text: change };

      if (current.mode === 'fields') {
        const fieldsChange = computeFieldsChangeFromSnapshotText(previous.text, current.text);
        if (fieldsChange) out.fields = fieldsChange;
      } else if (current.mode === 'json') {
        const jsonChange = computeJsonChangeFromSnapshotText(previous.text, current.text, input.ignore_json_paths);
        if (jsonChange) out.json = jsonChange;
      }

      return out;
    })(),
    previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
    current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
  };

  const { payload } = limitPayloadBytes(payloadBase, input.max_payload_bytes);

  let delivery: Awaited<ReturnType<typeof sendWebhook>> | null = null;
  try {
    delivery = await sendWebhook(input, payload);
    log.info('Change detected; webhook delivered.', { webhook_url: safeUrl(input.webhook_url, input.redact_logs), ...delivery });

    await pushHistory({
      event: 'CHANGE_DETECTED',
      timestamp: payload.timestamp,
      event_id: payload.event_id,
      stateKey,
      url: safeUrl(payload.url, input.redact_logs),
      selector: payload.selector,
      payload: { ...payload, url: safeUrl(payload.url, input.redact_logs) },
      fetch: snapshotFetchMetrics(current, input.redact_logs),
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
      fetch: snapshotFetchMetrics(current, input.redact_logs),
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
      fetch: snapshotFetchMetrics(current, input.redact_logs),
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
      fetch: snapshotFetchMetrics(current, input.redact_logs),
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
    fetch: snapshotFetchMetrics(current, input.redact_logs),
    webhook: delivery,
    stateKey,
  });
});
