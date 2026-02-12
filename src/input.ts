import { z } from 'zod';
import type { BaselineMode, HistoryMode, SentinelInput } from './types.js';

const httpUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'Must be an http(s) URL',
  });

const baselineModeSchema: z.ZodType<BaselineMode> = z.union([
  z.literal('store_only'),
  z.literal('notify'),
]);

const historyModeSchema: z.ZodType<HistoryMode> = z.union([
  z.literal('none'),
  z.literal('changes_only'),
  z.literal('all_events'),
]);

const rawInputSchema = z
  .object({
    target_url: httpUrl,
    selector: z.string().trim().min(1).optional(),
    webhook_url: httpUrl,
    webhook_headers: z.record(z.string(), z.string()).optional(),
    webhook_secret: z.string().min(1).optional(),
    baseline_mode: baselineModeSchema.optional(),
    state_store_name: z.string().trim().min(1).optional(),
    dead_letter_dataset_name: z.string().trim().min(1).optional(),
    history_dataset_name: z.string().trim().min(1).optional(),
    history_mode: historyModeSchema.optional(),

    timeout_secs: z.coerce.number().int().min(1).optional(),
    max_retries: z.coerce.number().int().min(0).optional(),
    retry_backoff_ms: z.coerce.number().int().min(0).optional(),

    fetch_timeout_secs: z.coerce.number().int().min(1).optional(),
    fetch_max_retries: z.coerce.number().int().min(0).optional(),
    fetch_retry_backoff_ms: z.coerce.number().int().min(0).optional(),

    webhook_timeout_secs: z.coerce.number().int().min(1).optional(),
    webhook_max_retries: z.coerce.number().int().min(0).optional(),
    webhook_retry_backoff_ms: z.coerce.number().int().min(0).optional(),
    webhook_retry_on_statuses: z.array(z.coerce.number().int().min(100).max(599)).optional(),
    webhook_retry_on_5xx: z.coerce.boolean().optional(),
    webhook_max_retry_time_secs: z.coerce.number().min(0).optional(),

    max_redirects: z.coerce.number().int().min(0).optional(),
    max_content_bytes: z.coerce.number().int().min(1).optional(),
    max_payload_bytes: z.coerce.number().int().min(1024).optional(),
    reset_baseline: z.coerce.boolean().optional(),

    ignore_selectors: z.array(z.string().trim().min(1)).optional(),
    ignore_regexes: z.array(z.string().trim().min(1)).optional(),
    redact_logs: z.coerce.boolean().optional(),
    debug: z.coerce.boolean().optional(),
  })
  .strict();

export function parseInput(raw: unknown): SentinelInput {
  const parsed = rawInputSchema.parse(raw ?? {});

  const timeout_secs = parsed.timeout_secs ?? 30;
  const max_retries = parsed.max_retries ?? 3;
  const retry_backoff_ms = parsed.retry_backoff_ms ?? 1000;

  return {
    target_url: parsed.target_url,
    selector: parsed.selector,
    webhook_url: parsed.webhook_url,
    webhook_headers: parsed.webhook_headers ?? {},
    webhook_secret: parsed.webhook_secret,
    baseline_mode: parsed.baseline_mode ?? 'store_only',
    state_store_name: parsed.state_store_name ?? 'sentinel-state',
    dead_letter_dataset_name: parsed.dead_letter_dataset_name ?? 'sentinel-dead-letter',
    history_dataset_name: parsed.history_dataset_name ?? 'sentinel-history',
    history_mode: parsed.history_mode ?? 'changes_only',

    timeout_secs,
    max_retries,
    retry_backoff_ms,

    fetch_timeout_secs: parsed.fetch_timeout_secs ?? timeout_secs,
    fetch_max_retries: parsed.fetch_max_retries ?? max_retries,
    fetch_retry_backoff_ms: parsed.fetch_retry_backoff_ms ?? retry_backoff_ms,

    webhook_timeout_secs: parsed.webhook_timeout_secs ?? timeout_secs,
    webhook_max_retries: parsed.webhook_max_retries ?? max_retries,
    webhook_retry_backoff_ms: parsed.webhook_retry_backoff_ms ?? retry_backoff_ms,
    webhook_retry_on_statuses: parsed.webhook_retry_on_statuses ?? [429],
    webhook_retry_on_5xx: parsed.webhook_retry_on_5xx ?? true,
    webhook_max_retry_time_secs: parsed.webhook_max_retry_time_secs,

    max_redirects: parsed.max_redirects ?? 5,
    max_content_bytes: parsed.max_content_bytes ?? 2_000_000,
    max_payload_bytes: parsed.max_payload_bytes ?? 250_000,
    reset_baseline: parsed.reset_baseline ?? false,

    ignore_selectors: parsed.ignore_selectors ?? [],
    ignore_regexes: parsed.ignore_regexes ?? [],
    redact_logs: parsed.redact_logs ?? true,
    debug: parsed.debug ?? false,
  };
}
