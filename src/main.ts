import { Actor, log } from 'apify';
import type { Dataset, KeyValueStore } from 'apify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseInput } from './input.js';
import { buildSnapshot, EmptySnapshotError, HttpError } from './snapshot.js';
import { approxChangeRatio, computeTextChange } from './diff.js';
import { diffJson } from './json_diff.js';
import { makeStateKeyV1, makeStateKeyV2 } from './state.js';
import { sendWebhook, WebhookDeliveryError } from './webhook.js';
import { assertSafeHttpUrl } from './url_safety.js';
import { redactText, redactUrl, truncate } from './redact.js';
import { computeEventId, computeRunScopedEventId } from './event_id.js';
import { limitPayloadBytes } from './payload_limit.js';
import { assertUrlAllowedByDomainPolicy } from './domain_policy.js';
import { makeUnifiedTextPatch } from './unified_diff.js';
import { decodeStoredSnapshot, encodeSnapshotForStore } from './stored_snapshot.js';
import { appendSnapshotHistory } from './snapshot_history.js';
import { makeArtifactKey, putJsonArtifact } from './artifacts.js';
import { captureAndStoreBaselineScreenshot, captureAndStoreChangeScreenshots, updateBaselineScreenshot } from './screenshot_mode.js';
import {
  isCircuitOpen,
  metaKeyForStateKey,
  recordRunMeta,
  recordWebhookFailure,
  recordWebhookSuccess,
  type TargetMeta,
} from './meta.js';
import type { ChangePayload, FetchFailedPayload, NoChangePayload, SentinelInput, Snapshot, TargetInput, WebhookPayload } from './types.js';

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

function safeUrls(urls: string[], redact: boolean): string[] {
  return urls.map((u) => safeUrl(u, redact));
}

function safeSnapshot(snapshot: Snapshot, redact: boolean): Snapshot {
  if (!redact) return snapshot;
  return {
    ...snapshot,
    url: redactUrl(snapshot.url),
    finalUrl: snapshot.finalUrl ? redactUrl(snapshot.finalUrl) : undefined,
    text: redactText(snapshot.text),
    html: snapshot.html ? redactText(snapshot.html) : undefined,
  };
}

type TargetRunResult = {
  target_url: string;
  stateKey: string;
  outcome:
    | 'BASELINE_STORED'
    | 'NO_CHANGE'
    | 'CHANGE_DETECTED'
    | 'CHANGE_SUPPRESSED'
    | 'FETCH_FAILED'
    | 'EMPTY_SNAPSHOT_IGNORED'
    | 'EMPTY_SNAPSHOT_ERROR'
    | 'WEBHOOK_FAILED'
    | 'WEBHOOK_SKIPPED_CIRCUIT_OPEN'
    | 'BASELINE_RESET'
    | 'TARGET_FAILED';
  durationMs?: number;
  fetch?: ReturnType<typeof snapshotFetchMetrics>;
  webhook?: Awaited<ReturnType<typeof sendWebhook>> | null;
};

function materializeTargetInput(base: SentinelInput, target: TargetInput): SentinelInput {
  return {
    ...base,
    target_url: target.target_url,
    selector: target.selector ?? base.selector,
    fields: target.fields ?? base.fields,
    ignore_json_paths: target.ignore_json_paths ?? base.ignore_json_paths,
    // Avoid recursive processing.
    targets: [],
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.floor(concurrency));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });

  await Promise.all(workers);
  return results;
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

function buildHumanSummary(changes: NonNullable<ChangePayload['changes']>): string {
  if (changes.fields) {
    const entries = Object.entries(changes.fields);
    const parts = entries
      .slice(0, 10)
      .map(([k, v]) => (typeof v.delta === 'number' ? `${k}: ${v.old} -> ${v.new} (delta ${v.delta})` : `${k}: ${v.old} -> ${v.new}`));
    const more = entries.length > 10 ? `; ... (+${entries.length - 10} more)` : '';
    return `Fields changed: ${parts.join('; ')}${more}`;
  }

  if (changes.json) {
    const diffs = changes.json.diffs;
    const parts = diffs
      .slice(0, 10)
      .map((d) => `${d.op} ${d.path}`)
      .join('; ');
    const more = diffs.length > 10 ? `; ... (+${diffs.length - 10} more)` : '';
    return `JSON changed: ${parts}${more}`;
  }

  const t = changes.text;
  if (!t) return 'Change detected';
  if (t.old.length <= 64 && t.new.length <= 64) {
    if (typeof t.delta === 'number') return `Value changed: ${t.old} -> ${t.new} (delta ${t.delta})`;
    return `Text changed: ${t.old} -> ${t.new}`;
  }

  return `Text changed (len ${t.old.length} -> ${t.new.length})`;
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
  const statusCode = err instanceof WebhookDeliveryError ? err.statusCode : err instanceof HttpError ? err.statusCode : undefined;
  const attempts = err instanceof WebhookDeliveryError ? err.attempts : undefined;
  const durationMs = err instanceof WebhookDeliveryError ? err.durationMs : undefined;
  const e = toError(err);
  const message = redact ? redactText(e.message) : e.message;
  return { name: e.name, message, statusCode, attempts, durationMs };
}

function buildDeadLetterPayloadPreview(payload: WebhookPayload, redact: boolean): { payload: WebhookPayload; truncated: boolean } {
  const out: WebhookPayload = {
    ...payload,
    url: safeUrl(payload.url, redact),
  };

  if (payload.event !== 'CHANGE_DETECTED' && payload.event !== 'BASELINE_STORED') return { payload: out, truncated: false };
  const textChange = payload.changes?.text;
  if (!textChange) return { payload: out, truncated: false };

  const oldT = truncate(textChange.old, 5_000);
  const newT = truncate(textChange.new, 5_000);
  const outChange: ChangePayload = {
    ...(out as ChangePayload),
    changes: {
      ...payload.changes,
      text: {
        ...textChange,
        old: oldT.text,
        new: newT.text,
      },
    },
  };
  return {
    payload: outChange,
    truncated: oldT.truncated || newT.truncated,
  };
}

async function processTarget(
  input: SentinelInput,
  deps: { kv: KeyValueStore; history: Dataset | null; dead: Dataset; artifacts: KeyValueStore | null },
): Promise<TargetRunResult> {
  const { kv, history, dead, artifacts } = deps;

	  const stateKeyV2 = makeStateKeyV2({
	    targetUrl: input.target_url,
	    selector: input.selector,
	    renderingMode: input.rendering_mode,
	    waitUntil: input.wait_until,
	    waitForSelector: input.wait_for_selector,
	    waitForSelectorTimeoutSecs: input.wait_for_selector_timeout_secs,
	    fetchHeaders: input.fetch_headers,
	    targetMethod: input.target_method,
	    targetBody: input.target_body,
	    targetCookies: input.target_cookies,
	    robotsTxtMode: input.robots_txt_mode,
	    blockPageRegexes: input.block_page_regexes,
	    selectorAggregationMode: input.selector_aggregation_mode,
	    whitespaceMode: input.whitespace_mode,
	    unicodeNormalization: input.unicode_normalization,
	    fields: input.fields,
	    ignoreJsonPaths: input.ignore_json_paths,
	    ignoreSelectors: input.ignore_selectors,
	    ignoreAttributes: input.ignore_attributes,
	    ignoreRegexes: input.ignore_regexes,
	  });
  const stateKeyV1 = makeStateKeyV1(input.target_url, input.selector);
  const stateKey = stateKeyV2;
  const startedTargetAt = Date.now();

  const metaKey = metaKeyForStateKey(stateKey);
  let meta = ((await kv.getValue<TargetMeta>(metaKey)) ?? null) as TargetMeta | null;

  async function finish(outcome: TargetRunResult['outcome'], extra: Partial<TargetRunResult> = {}): Promise<TargetRunResult> {
    const durationMs = Date.now() - startedTargetAt;
    meta = recordRunMeta(meta, outcome);
    await kv.setValue(metaKey, meta);
    if (input.structured_logs) {
      // Single-line JSON for log aggregation tools.
      console.log(
        JSON.stringify({
          event: 'TARGET_RESULT',
          timestamp: new Date().toISOString(),
          stateKey,
          target_url: safeUrl(input.target_url, input.redact_logs),
          selector: input.selector,
          outcome,
          durationMs,
        }),
      );
    }
    return { target_url: input.target_url, stateKey, outcome, durationMs, ...extra };
  }

  async function pushHistory(item: Record<string, unknown>): Promise<void> {
    if (!history) return;
    if (input.history_mode === 'changes_only' && item.event !== 'CHANGE_DETECTED') return;
    await history.pushData(item);
  }

  try {
    // Fail fast on unsafe target URL (SSRF protection).
    await assertSafeHttpUrl(input.target_url, 'target_url', {
      allowLocalhost: input.allow_localhost && !(Actor.getEnv().isAtHome ?? false),
    });
    assertUrlAllowedByDomainPolicy(input.target_url, 'target_url', {
      allowlist: input.target_domain_allowlist,
      denylist: input.target_domain_denylist,
    });

    const storedPreviousV2Raw = (await kv.getValue<unknown>(stateKeyV2)) ?? null;
    const storedPreviousV2 = storedPreviousV2Raw ? decodeStoredSnapshot(storedPreviousV2Raw) : null;
    const storedPreviousV1Raw = storedPreviousV2 ? null : ((await kv.getValue<unknown>(stateKeyV1)) ?? null);
    const storedPreviousV1 = storedPreviousV1Raw ? decodeStoredSnapshot(storedPreviousV1Raw) : null;
    const storedPrevious = storedPreviousV2 ?? storedPreviousV1;
    const migratedFromV1 = !!storedPreviousV1;
    const previous = input.reset_baseline ? null : storedPrevious;

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
        return await finish('EMPTY_SNAPSHOT_IGNORED');
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

      if (input.notify_on_fetch_failure) {
        const safeErr = toSafeError(err, input.redact_logs);
        const signature = `${safeErr.name}:${safeErr.statusCode ?? ''}:${safeErr.message.slice(0, 200)}`;

        const now = new Date();
        const lastAtMs = meta?.last_fetch_failure_notified_at ? Date.parse(meta.last_fetch_failure_notified_at) : NaN;
        const withinDebounce =
          Number.isFinite(lastAtMs) && now.getTime() - lastAtMs < Math.max(0, input.fetch_failure_debounce_secs) * 1000;

        if (!(withinDebounce && meta?.last_fetch_failure_signature === signature)) {
          if (input.webhook_circuit_breaker_enabled && isCircuitOpen(meta, now)) {
            log.warning('Fetch failure notification skipped (webhook circuit open).', { stateKey });
          } else {
            const runId = Actor.getEnv().actorRunId ?? 'local';
            const payloadBase: FetchFailedPayload = {
              schema_version: 1,
              event_id: computeRunScopedEventId({
                event: 'FETCH_FAILED',
                runId,
                url: input.target_url,
                selector: input.selector,
                signature,
              }),
              event: 'FETCH_FAILED',
              url: input.target_url,
              selector: input.selector,
              timestamp,
              previous: previous ? { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt } : undefined,
              error: safeErr,
            };

            const { payload } = limitPayloadBytes(payloadBase, input.max_payload_bytes);

            try {
              const delivery = await sendWebhook(input, payload);
              meta = recordWebhookSuccess(meta);
              meta = { ...(meta ?? {}), last_fetch_failure_notified_at: now.toISOString(), last_fetch_failure_signature: signature };
              log.info('Fetch failure notification webhook delivered.', { stateKey, ...delivery });
            } catch (notifyErr) {
              const recorded = recordWebhookFailure(meta, notifyErr, {
                threshold: input.webhook_circuit_failure_threshold,
                cooldownSecs: input.webhook_circuit_cooldown_secs,
                now,
              });
              meta = recorded.meta;
              const notifySafeErr = toSafeError(notifyErr, input.redact_logs);
              log.error('Fetch failure notification webhook failed.', { stateKey, error: notifySafeErr });
            }
          }
        } else {
          log.info('Fetch failure notification debounced.', { stateKey, fetch_failure_debounce_secs: input.fetch_failure_debounce_secs });
        }
      }

      return await finish(isEmpty ? 'EMPTY_SNAPSHOT_ERROR' : 'FETCH_FAILED');
    }

    // Clear fetch-failure debounce state after a successful snapshot.
    if (meta?.last_fetch_failure_signature || meta?.last_fetch_failure_notified_at) {
      meta = {
        ...meta,
        last_fetch_failure_signature: undefined,
        last_fetch_failure_notified_at: undefined,
      };
    }

    meta = {
      ...(meta ?? {}),
      last_success_snapshot_at: current.fetchedAt,
      last_success_content_hash: current.contentHash,
      last_success_status_code: current.statusCode,
      last_success_final_url: current.finalUrl,
    };

    if (!previous) {
      await kv.setValue(stateKey, encodeSnapshotForStore(current, input.compress_snapshots));
      await appendSnapshotHistory(kv, stateKey, current, input.snapshot_history_limit);
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

      const fetchMetrics = snapshotFetchMetrics(current, input.redact_logs);
      let baselineDelivery: Awaited<ReturnType<typeof sendWebhook>> | null = null;

      if (input.screenshot_on_change && artifacts) {
        if (input.rendering_mode !== 'playwright') {
          log.warning('screenshot_on_change is only supported with rendering_mode=playwright; skipping baseline screenshot.', { stateKey });
        } else {
          try {
            await captureAndStoreBaselineScreenshot(input, { artifacts, stateKey });
          } catch (err) {
            log.warning('Failed to capture baseline screenshot.', { stateKey, error: toSafeError(err, input.redact_logs) });
          }
        }
      }

      if (input.baseline_mode === 'notify') {
        if (input.webhook_circuit_breaker_enabled && isCircuitOpen(meta)) {
          const timestamp = new Date().toISOString();
          log.warning('Webhook circuit open; skipping baseline webhook delivery.', {
            stateKey,
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
          });
          await Actor.pushData({
            event: 'WEBHOOK_CIRCUIT_OPEN',
            timestamp,
            stateKey,
            webhook_url: safeUrl(input.webhook_url, input.redact_logs),
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
            target_url: safeUrl(input.target_url, input.redact_logs),
            selector: input.selector,
            reason: 'circuit_open',
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
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
            delivered: false,
            webhook_skipped: true,
            reason: 'circuit_open',
          });

          return await finish('BASELINE_STORED', { fetch: fetchMetrics, webhook: null });
        }

        try {
          const delivery = await sendWebhook(input, payload);
          baselineDelivery = delivery;
          meta = recordWebhookSuccess(meta);
          log.info('Baseline webhook sent.', { webhook_urls: safeUrls(input.webhook_urls, input.redact_logs), ...delivery });

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
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
            delivered: true,
            delivery,
          });
        } catch (err) {
          const recorded = recordWebhookFailure(meta, err, {
            threshold: input.webhook_circuit_failure_threshold,
            cooldownSecs: input.webhook_circuit_cooldown_secs,
          });
          meta = recorded.meta;
          if (input.webhook_circuit_breaker_enabled && recorded.tripped) {
            await Actor.pushData({
              event: 'WEBHOOK_CIRCUIT_TRIPPED',
              timestamp: new Date().toISOString(),
              stateKey,
              webhook_url: safeUrl(input.webhook_url, input.redact_logs),
              webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
              target_url: safeUrl(input.target_url, input.redact_logs),
              selector: input.selector,
              webhook_circuit_open_until: meta.webhook_circuit_open_until,
              webhook_consecutive_failures: meta.webhook_consecutive_failures,
            });
          }

          const safeErr = toSafeError(err, input.redact_logs);
          const preview = buildDeadLetterPayloadPreview(payload, input.redact_logs);
          await dead.pushData({
            event: 'WEBHOOK_DELIVERY_FAILED',
            timestamp: new Date().toISOString(),
            stateKey,
            webhook_url: safeUrl(input.webhook_url, input.redact_logs),
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
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
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
            target_url: safeUrl(input.target_url, input.redact_logs),
            selector: input.selector,
            fetch: snapshotFetchMetrics(current, input.redact_logs),
            error: safeErr,
          });

          log.error('Baseline webhook delivery failed (stored in dead-letter dataset).', {
            webhook_url: safeUrl(input.webhook_url, input.redact_logs),
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
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
            webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
            delivered: false,
            error: safeErr,
          });

          return await finish('WEBHOOK_FAILED', { fetch: fetchMetrics, webhook: null });
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

      return await finish('BASELINE_STORED', { fetch: fetchMetrics, webhook: baselineDelivery });
    }

    const change = computeTextChange(previous, current);
    if (!change) {
      log.info('No change detected.', { stateKey, contentHash: current.contentHash });
      const fetchMetrics = snapshotFetchMetrics(current, input.redact_logs);
      let noChangeDelivery: Awaited<ReturnType<typeof sendWebhook>> | null = null;
      await Actor.pushData({
        event: 'NO_CHANGE',
        url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
        timestamp: new Date().toISOString(),
        previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
        current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
        fetch: fetchMetrics,
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
          fetch: fetchMetrics,
        });
      }

      if (input.notify_on_no_change) {
        const now = new Date();
        if (input.webhook_circuit_breaker_enabled && isCircuitOpen(meta, now)) {
          log.warning('No-change notification skipped (webhook circuit open).', { stateKey });
        } else {
          const runId = Actor.getEnv().actorRunId ?? 'local';
          const payloadBase: NoChangePayload = {
            schema_version: 1,
            event_id: computeRunScopedEventId({
              event: 'NO_CHANGE',
              runId,
              url: input.target_url,
              selector: input.selector,
              currentHash: current.contentHash,
            }),
            event: 'NO_CHANGE',
            url: input.target_url,
            selector: input.selector,
            timestamp: new Date().toISOString(),
            previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
            current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
          };

          const { payload } = limitPayloadBytes(payloadBase, input.max_payload_bytes);
          try {
            const delivery = await sendWebhook(input, payload);
            noChangeDelivery = delivery;
            meta = recordWebhookSuccess(meta);
            meta = { ...(meta ?? {}), last_no_change_notified_at: now.toISOString() };
            log.info('No-change notification webhook delivered.', { stateKey, ...delivery });
          } catch (notifyErr) {
            const recorded = recordWebhookFailure(meta, notifyErr, {
              threshold: input.webhook_circuit_failure_threshold,
              cooldownSecs: input.webhook_circuit_cooldown_secs,
              now,
            });
            meta = recorded.meta;
            const notifySafeErr = toSafeError(notifyErr, input.redact_logs);
            log.error('No-change notification webhook failed.', { stateKey, error: notifySafeErr });
          }
        }
      }

      // Refresh baseline metadata (timestamps/headers) even if content is unchanged.
      await kv.setValue(stateKey, encodeSnapshotForStore(current, input.compress_snapshots));
      return await finish('NO_CHANGE', { fetch: fetchMetrics, webhook: noChangeDelivery });
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

        if (input.screenshot_on_change && artifacts) {
          if (input.rendering_mode !== 'playwright') {
            log.warning('screenshot_on_change is only supported with rendering_mode=playwright; skipping baseline screenshot update.', {
              stateKey,
            });
          } else {
            try {
              await captureAndStoreBaselineScreenshot(input, { artifacts, stateKey });
            } catch (err) {
              log.warning('Failed to update baseline screenshot on suppressed change.', {
                stateKey,
                error: toSafeError(err, input.redact_logs),
              });
            }
          }
        }

        // Suppress alert but still advance baseline to avoid repeated detections.
        await kv.setValue(stateKey, encodeSnapshotForStore(current, input.compress_snapshots));
        await appendSnapshotHistory(kv, stateKey, current, input.snapshot_history_limit);
        return await finish('CHANGE_SUPPRESSED', { fetch: snapshotFetchMetrics(current, input.redact_logs), webhook: null });
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
		    if (payload.event === 'CHANGE_DETECTED' && payload.changes) {
		      (payload as ChangePayload).summary = buildHumanSummary(payload.changes);

	      if (input.include_unified_diff && payload.changes.text) {
	        const { patch, truncated } = makeUnifiedTextPatch(payload.changes.text.old, payload.changes.text.new, {
	          contextLines: input.unified_diff_context_lines,
	          maxChars: input.unified_diff_max_chars,
	        });
	        payload.changes.text.patch = patch;
	        if (truncated) payload.changes.text.patch_truncated = true;

	        const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
	        if (bytes > input.max_payload_bytes) {
	          // Patch is optional; drop it rather than failing the webhook.
	          payload.changes.text.patch = undefined;
	          payload.changes.text.patch_truncated = undefined;
	        }
		      }
		    }

		    let delivery: Awaited<ReturnType<typeof sendWebhook>> | null = null;
		    if (input.webhook_circuit_breaker_enabled && isCircuitOpen(meta)) {
	      const timestamp = new Date().toISOString();
	      log.warning('Webhook circuit open; skipping delivery. Baseline NOT updated.', {
	        stateKey,
	        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
	      });
      await Actor.pushData({
        event: 'WEBHOOK_CIRCUIT_OPEN',
        timestamp,
        stateKey,
        webhook_url: safeUrl(input.webhook_url, input.redact_logs),
        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
        target_url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
        reason: 'circuit_open',
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
        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
        delivered: false,
        webhook_skipped: true,
        reason: 'circuit_open',
      });

	      return await finish('WEBHOOK_SKIPPED_CIRCUIT_OPEN', { fetch: snapshotFetchMetrics(current, input.redact_logs), webhook: null });
	    }

		    if (payload.event === 'CHANGE_DETECTED' && input.store_debug_artifacts && artifacts) {
		      try {
		        const prevKey = makeArtifactKey({ stateKey, eventId: payload.event_id, name: 'previous_snapshot.json' });
		        const currKey = makeArtifactKey({ stateKey, eventId: payload.event_id, name: 'current_snapshot.json' });
		        const prevRef = await putJsonArtifact(
		          artifacts,
		          input.artifact_store_name,
		          prevKey,
		          safeSnapshot(previous, input.redact_logs),
		        );
		        const currRef = await putJsonArtifact(
		          artifacts,
		          input.artifact_store_name,
		          currKey,
		          safeSnapshot(current, input.redact_logs),
		        );

		        (payload as ChangePayload).artifacts = {
		          ...(payload as ChangePayload).artifacts,
		          debug: { previous_snapshot: prevRef, current_snapshot: currRef },
		        };
		      } catch (err) {
		        log.warning('Failed to store debug artifacts.', { stateKey, error: toSafeError(err, input.redact_logs) });
		      }
		    }

		    let afterScreenshotPng: Buffer | null = null;
		    if (payload.event === 'CHANGE_DETECTED' && input.screenshot_on_change && artifacts) {
		      if (input.rendering_mode !== 'playwright') {
		        log.warning('screenshot_on_change is only supported with rendering_mode=playwright; skipping screenshots.', { stateKey });
		      } else {
		        try {
		          const res = await captureAndStoreChangeScreenshots(input, { artifacts, stateKey, eventId: payload.event_id });
		          if (res) {
		            afterScreenshotPng = res.afterPng;
		            (payload as ChangePayload).artifacts = {
		              ...(payload as ChangePayload).artifacts,
		              screenshots: res.screenshots,
		            };
		          }
		        } catch (err) {
		          log.warning('Failed to capture/store screenshots.', { stateKey, error: toSafeError(err, input.redact_logs) });
		        }
		      }
		    }

	    try {
	      delivery = await sendWebhook(input, payload);
	      meta = recordWebhookSuccess(meta);
	      log.info('Change detected; webhook delivered.', { webhook_urls: safeUrls(input.webhook_urls, input.redact_logs), ...delivery });

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
        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
        delivered: true,
        delivery,
      });
    } catch (err) {
      const recorded = recordWebhookFailure(meta, err, {
        threshold: input.webhook_circuit_failure_threshold,
        cooldownSecs: input.webhook_circuit_cooldown_secs,
      });
      meta = recorded.meta;
      if (input.webhook_circuit_breaker_enabled && recorded.tripped) {
        await Actor.pushData({
          event: 'WEBHOOK_CIRCUIT_TRIPPED',
          timestamp: new Date().toISOString(),
          stateKey,
          webhook_url: safeUrl(input.webhook_url, input.redact_logs),
          webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
          target_url: safeUrl(input.target_url, input.redact_logs),
          selector: input.selector,
          webhook_circuit_open_until: meta.webhook_circuit_open_until,
          webhook_consecutive_failures: meta.webhook_consecutive_failures,
        });
      }

      const safeErr = toSafeError(err, input.redact_logs);
      const preview = buildDeadLetterPayloadPreview(payload, input.redact_logs);
      await dead.pushData({
        event: 'WEBHOOK_DELIVERY_FAILED',
        timestamp: new Date().toISOString(),
        stateKey,
        webhook_url: safeUrl(input.webhook_url, input.redact_logs),
        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
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
        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
        target_url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
        fetch: snapshotFetchMetrics(current, input.redact_logs),
        error: safeErr,
      });

      log.error('Change detected but webhook delivery failed. Baseline NOT updated (will retry next run).', {
        webhook_url: safeUrl(input.webhook_url, input.redact_logs),
        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
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
        webhook_urls: safeUrls(input.webhook_urls, input.redact_logs),
        delivered: false,
        error: safeErr,
      });

      return await finish('WEBHOOK_FAILED', { fetch: snapshotFetchMetrics(current, input.redact_logs), webhook: null });
    }

	    await kv.setValue(stateKey, encodeSnapshotForStore(current, input.compress_snapshots));
	    await appendSnapshotHistory(kv, stateKey, current, input.snapshot_history_limit);
	    if (afterScreenshotPng && artifacts) {
	      try {
	        await updateBaselineScreenshot(input, { artifacts, stateKey, png: afterScreenshotPng });
	      } catch (err) {
	        log.warning('Failed to update baseline screenshot after change.', { stateKey, error: toSafeError(err, input.redact_logs) });
	      }
	    }
	    await Actor.pushData({
	      ...payload,
	      url: safeUrl(payload.url, input.redact_logs),
	      fetch: snapshotFetchMetrics(current, input.redact_logs),
      webhook: delivery,
      stateKey,
    });

    return await finish('CHANGE_DETECTED', { fetch: snapshotFetchMetrics(current, input.redact_logs), webhook: delivery });
  } catch (err) {
    const safeErr = toSafeError(err, input.redact_logs);
    log.exception(toError(err), 'Target processing failed.');
    await Actor.pushData({
      event: 'TARGET_FAILED',
      timestamp: new Date().toISOString(),
      stateKey,
      url: safeUrl(input.target_url, input.redact_logs),
      selector: input.selector,
      error: safeErr,
    });
    if (input.history_mode === 'all_events') {
      await pushHistory({
        event: 'TARGET_FAILED',
        timestamp: new Date().toISOString(),
        stateKey,
        url: safeUrl(input.target_url, input.redact_logs),
        selector: input.selector,
        error: safeErr,
      });
    }
    return await finish('TARGET_FAILED');
  }
}

async function replayDeadLetters(input: SentinelInput, deps: { history: Dataset | null; dead: Dataset }): Promise<void> {
  const { history, dead } = deps;

  const pageSize = 100;
  const wanted = Math.max(1, input.replay_limit);
  const items: unknown[] = [];

  for (let offset = 0; items.length < wanted; offset += pageSize) {
    const res = await dead.getData({ offset, limit: Math.min(pageSize, wanted - items.length), desc: true });
    const batch = (res.items ?? []) as unknown[];
    if (batch.length === 0) break;
    items.push(...batch);
  }

  log.info('Replaying dead-letter items.', { items: items.length, replay_limit: input.replay_limit });

  type ReplayResult = { ok: boolean; skipped: boolean };

  function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function isWebhookPayload(value: unknown): value is WebhookPayload {
    if (!isRecord(value)) return false;
    if (value.schema_version !== 1) return false;
    if (typeof value.event_id !== 'string' || value.event_id.length === 0) return false;
    if (typeof value.event !== 'string' || value.event.length === 0) return false;
    if (typeof value.url !== 'string' || value.url.length === 0) return false;
    if (typeof value.timestamp !== 'string' || value.timestamp.length === 0) return false;
    return true;
  }

  const results = await mapWithConcurrency<unknown, ReplayResult>(items, input.max_concurrency, async (item) => {
    if (!isRecord(item)) {
      await Actor.pushData({
        event: 'DEAD_LETTER_REPLAY_SKIPPED',
        timestamp: new Date().toISOString(),
        reason: 'Item is not an object',
      });
      return { ok: false, skipped: true };
    }

    const payloadRaw = item.payload;
    if (!isWebhookPayload(payloadRaw)) {
      await Actor.pushData({
        event: 'DEAD_LETTER_REPLAY_SKIPPED',
        timestamp: new Date().toISOString(),
        reason: 'Missing or invalid payload',
      });
      return { ok: false, skipped: true };
    }

    const eventId = payloadRaw.event_id;
    const storedWebhookUrl = typeof item.webhook_url === 'string' ? item.webhook_url : null;
    const webhookUrl =
      input.replay_use_stored_webhook_url && typeof storedWebhookUrl === 'string' && storedWebhookUrl.length > 0
        ? storedWebhookUrl
        : input.webhook_url;

    const replayInput: SentinelInput = { ...input, webhook_url: webhookUrl, webhook_urls: [webhookUrl] };

    if (input.replay_dry_run) {
      await Actor.pushData({
        event: 'DEAD_LETTER_REPLAY_DRY_RUN',
        timestamp: new Date().toISOString(),
        webhook_url: safeUrl(webhookUrl, input.redact_logs),
        event_id: eventId,
      });
      return { ok: true, skipped: false };
    }

    try {
      const delivery = await sendWebhook(replayInput, payloadRaw);
      await Actor.pushData({
        event: 'DEAD_LETTER_REPLAY_OK',
        timestamp: new Date().toISOString(),
        webhook_url: safeUrl(webhookUrl, input.redact_logs),
        event_id: eventId,
        delivery,
      });

      if (history && input.history_mode === 'all_events') {
        await history.pushData({
          event: 'DEAD_LETTER_REPLAY_OK',
          timestamp: new Date().toISOString(),
          webhook_url: safeUrl(webhookUrl, input.redact_logs),
          event_id: eventId,
          delivery,
        });
      }

      return { ok: true, skipped: false };
    } catch (err) {
      const safeErr = toSafeError(err, input.redact_logs);
      await Actor.pushData({
        event: 'DEAD_LETTER_REPLAY_FAILED',
        timestamp: new Date().toISOString(),
        webhook_url: safeUrl(webhookUrl, input.redact_logs),
        event_id: eventId,
        error: safeErr,
      });

      if (history && input.history_mode === 'all_events') {
        await history.pushData({
          event: 'DEAD_LETTER_REPLAY_FAILED',
          timestamp: new Date().toISOString(),
          webhook_url: safeUrl(webhookUrl, input.redact_logs),
          event_id: eventId,
          error: safeErr,
        });
      }

      return { ok: false, skipped: false };
    }
  });

  const ok = results.filter((r) => r.ok).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.length - ok - skipped;

  const timestamp = new Date().toISOString();
  await Actor.pushData({
    event: 'DEAD_LETTER_REPLAY_SUMMARY',
    timestamp,
    total: results.length,
    ok,
    failed,
    skipped,
    dry_run: input.replay_dry_run,
  });

  if (history && input.history_mode === 'all_events') {
    await history.pushData({
      event: 'DEAD_LETTER_REPLAY_SUMMARY',
      timestamp,
      total: results.length,
      ok,
      failed,
      skipped,
      dry_run: input.replay_dry_run,
    });
  }
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

  const allowLocalhost = input.allow_localhost && !(Actor.getEnv().isAtHome ?? false);
  if (input.allow_localhost && !allowLocalhost) {
    log.warning('allow_localhost is ignored when running on the Apify platform.', {});
  }

  if (input.mode === 'monitor' && input.schedule_jitter_ms > 0) {
    const jitter = Math.floor(Math.random() * (input.schedule_jitter_ms + 1));
    if (jitter > 0) {
      log.info('Applying schedule jitter delay.', { jitter_ms: jitter });
      await new Promise<void>((resolve) => setTimeout(resolve, jitter));
    }
  }

  if (input.mode === 'monitor') {
    // Fail fast on unsafe webhook URLs (SSRF protection).
    for (const url of input.webhook_urls) {
      await assertSafeHttpUrl(url, 'webhook_url', { allowLocalhost });
      assertUrlAllowedByDomainPolicy(url, 'webhook_url', {
        allowlist: input.webhook_domain_allowlist,
        denylist: input.webhook_domain_denylist,
      });
    }
  }

  const history = input.history_mode === 'none' ? null : await Actor.openDataset(input.history_dataset_name);
  const dead = await Actor.openDataset(input.dead_letter_dataset_name);

  if (input.mode === 'replay_dead_letter') {
    await replayDeadLetters(input, { history, dead });
    return;
  }

  if (input.targets.length === 0) {
    throw new Error('No targets provided. Provide target_url or non-empty targets[].');
  }

  const kv = await Actor.openKeyValueStore(input.state_store_name);
  const needArtifacts = input.store_debug_artifacts || input.screenshot_on_change;
  const artifactStore = needArtifacts ? await Actor.openKeyValueStore(input.artifact_store_name) : null;

  const targetInputs = input.targets.map((t) => materializeTargetInput(input, t));
  log.info('Processing targets.', { targets: targetInputs.length, max_concurrency: input.max_concurrency });

  const runStartedAt = Date.now();
  const results = await mapWithConcurrency(targetInputs, input.max_concurrency, async (ti) =>
    processTarget(ti, { kv, history, dead, artifacts: artifactStore }),
  );
  const runDurationMs = Date.now() - runStartedAt;

  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  }

  const targetDurations = results.map((r) => r.durationMs).filter((n): n is number => typeof n === 'number');
  const targets_total_duration_ms = targetDurations.reduce((a, b) => a + b, 0);

  const fetchDurations = results.map((r) => r.fetch?.durationMs).filter((n): n is number => typeof n === 'number');
  const fetch_total_duration_ms = fetchDurations.reduce((a, b) => a + b, 0);
  const fetch_total_bytes_read = results
    .map((r) => r.fetch?.bytesRead)
    .filter((n): n is number => typeof n === 'number')
    .reduce((a, b) => a + b, 0);
  const fetch_total_attempts = results
    .map((r) => r.fetch?.attempts)
    .filter((n): n is number => typeof n === 'number')
    .reduce((a, b) => a + b, 0);
  const fetch_retried_targets = results.filter((r) => typeof r.fetch?.attempts === 'number' && (r.fetch?.attempts ?? 0) > 1)
    .length;

  const webhook_total_duration_ms = results
    .map((r) => r.webhook?.durationMs)
    .filter((n): n is number => typeof n === 'number')
    .reduce((a, b) => a + b, 0);
  const webhook_total_attempts = results
    .map((r) => r.webhook?.attempts)
    .filter((n): n is number => typeof n === 'number')
    .reduce((a, b) => a + b, 0);
  const webhook_deliveries_total = results.reduce((sum, r) => sum + (r.webhook?.deliveries?.length ?? 0), 0);

  const timestamp = new Date().toISOString();
  await Actor.pushData({
    event: 'RUN_SUMMARY',
    timestamp,
    run_duration_ms: runDurationMs,
    targets_total: results.length,
    targets_total_duration_ms,
    outcomes: counts,
    fetch: {
      total_duration_ms: fetch_total_duration_ms,
      avg_duration_ms: fetchDurations.length > 0 ? Math.round(fetch_total_duration_ms / fetchDurations.length) : 0,
      total_bytes_read: fetch_total_bytes_read,
      total_attempts: fetch_total_attempts,
      retried_targets: fetch_retried_targets,
    },
    webhook: {
      total_duration_ms: webhook_total_duration_ms,
      total_attempts: webhook_total_attempts,
      deliveries_total: webhook_deliveries_total,
    },
    failures: results
      .filter(
        (r) =>
          r.outcome === 'FETCH_FAILED' ||
          r.outcome === 'EMPTY_SNAPSHOT_ERROR' ||
          r.outcome === 'WEBHOOK_FAILED' ||
          r.outcome === 'WEBHOOK_SKIPPED_CIRCUIT_OPEN' ||
          r.outcome === 'TARGET_FAILED',
      )
      .map((r) => ({
        target_url: safeUrl(r.target_url, input.redact_logs),
        stateKey: r.stateKey,
        outcome: r.outcome,
      })),
  });

  if (input.structured_logs) {
    console.log(
      JSON.stringify({
        event: 'RUN_SUMMARY',
        timestamp,
        run_duration_ms: runDurationMs,
        targets_total: results.length,
        outcomes: counts,
      }),
    );
  }

  if (history && input.history_mode === 'all_events') {
    await history.pushData({
      event: 'RUN_SUMMARY',
      timestamp,
      targets_total: results.length,
      outcomes: counts,
    });
  }
});
