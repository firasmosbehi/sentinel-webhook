import { z } from 'zod';
import type {
  BaselineMode,
  HistoryMode,
  IgnoreRegexPreset,
  OnEmptySnapshotBehavior,
  RunMode,
  RenderingMode,
  SentinelInput,
  WaitUntil,
} from './types.js';
import { normalizeHttpUrl } from './url_normalize.js';
import { expandIgnoreRegexPresets } from './regex_presets.js';

const httpUrl = z
  .string()
  .url()
  .refine((u) => u.toLowerCase().startsWith('http://') || u.toLowerCase().startsWith('https://'), {
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

const modeSchema: z.ZodType<RunMode> = z.union([z.literal('monitor'), z.literal('replay_dead_letter')]);

const renderingModeSchema: z.ZodType<RenderingMode> = z.union([z.literal('static'), z.literal('playwright')]);

const waitUntilSchema: z.ZodType<WaitUntil> = z.union([
  z.literal('domcontentloaded'),
  z.literal('load'),
  z.literal('networkidle'),
]);

const onEmptySnapshotSchema: z.ZodType<OnEmptySnapshotBehavior> = z.union([
  z.literal('error'),
  z.literal('treat_as_change'),
  z.literal('ignore'),
]);

const ignoreRegexPresetSchema: z.ZodType<IgnoreRegexPreset> = z.union([
  z.literal('timestamps'),
  z.literal('uuids'),
  z.literal('tokens'),
]);

const fieldTextSchema = z
  .object({
    name: z.string().trim().min(1),
    selector: z.string().trim().min(1),
    type: z.literal('text'),
  })
  .strict();

const fieldAttributeSchema = z
  .object({
    name: z.string().trim().min(1),
    selector: z.string().trim().min(1),
    type: z.literal('attribute'),
    attribute: z.string().trim().min(1),
  })
  .strict();

const targetSpecSchema = z
  .object({
    target_url: httpUrl,
    selector: z.string().trim().min(1).optional(),
    fields: z.array(z.union([fieldTextSchema, fieldAttributeSchema])).optional(),
    ignore_json_paths: z.array(z.string().trim().min(1)).optional(),
  })
  .strict();

const rawInputSchema = z
  .object({
    mode: modeSchema.optional(),
    target_url: httpUrl.optional(),
    selector: z.string().trim().min(1).optional(),
    targets: z.array(targetSpecSchema).min(1).optional(),
    rendering_mode: renderingModeSchema.optional(),
    wait_until: waitUntilSchema.optional(),
    wait_for_selector: z.string().trim().min(1).optional(),
    wait_for_selector_timeout_secs: z.coerce.number().int().min(1).optional(),
    fetch_headers: z.record(z.string(), z.string()).optional(),
    proxy_configuration: z
      .object({
        use_apify_proxy: z.coerce.boolean().optional(),
        apify_proxy_groups: z.array(z.string().trim().min(1)).optional(),
        apify_proxy_country: z.string().trim().min(1).optional(),
        proxy_urls: z.array(httpUrl).optional(),
      })
      .strict()
      .optional(),
    target_domain_allowlist: z.array(z.string().trim().min(1)).optional(),
    target_domain_denylist: z.array(z.string().trim().min(1)).optional(),
    webhook_url: httpUrl,
    webhook_headers: z.record(z.string(), z.string()).optional(),
    webhook_domain_allowlist: z.array(z.string().trim().min(1)).optional(),
    webhook_domain_denylist: z.array(z.string().trim().min(1)).optional(),
    webhook_secret: z.string().min(1).optional(),
    baseline_mode: baselineModeSchema.optional(),
    state_store_name: z.string().trim().min(1).optional(),
    dead_letter_dataset_name: z.string().trim().min(1).optional(),
    replay_limit: z.coerce.number().int().min(1).optional(),
    replay_use_stored_webhook_url: z.coerce.boolean().optional(),
    replay_dry_run: z.coerce.boolean().optional(),
    history_dataset_name: z.string().trim().min(1).optional(),
    history_mode: historyModeSchema.optional(),

    timeout_secs: z.coerce.number().int().min(1).optional(),
    max_retries: z.coerce.number().int().min(0).optional(),
    retry_backoff_ms: z.coerce.number().int().min(0).optional(),

    fetch_timeout_secs: z.coerce.number().int().min(1).optional(),
    fetch_connect_timeout_secs: z.coerce.number().int().min(1).optional(),
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
    politeness_delay_ms: z.coerce.number().int().min(0).optional(),
    politeness_jitter_ms: z.coerce.number().int().min(0).optional(),
    max_concurrency: z.coerce.number().int().min(1).optional(),
    max_payload_bytes: z.coerce.number().int().min(1024).optional(),
    reset_baseline: z.coerce.boolean().optional(),
    min_text_length: z.coerce.number().int().min(0).optional(),
    on_empty_snapshot: onEmptySnapshotSchema.optional(),
    min_change_ratio: z.coerce.number().min(0).max(1).optional(),
    fields: z.array(z.union([fieldTextSchema, fieldAttributeSchema])).optional(),
    ignore_json_paths: z.array(z.string().trim().min(1)).optional(),

    ignore_selectors: z.array(z.string().trim().min(1)).optional(),
    ignore_attributes: z.array(z.string().trim().min(1)).optional(),
    ignore_regexes: z.array(z.string().trim().min(1)).optional(),
    ignore_regex_presets: z.array(ignoreRegexPresetSchema).optional(),
    redact_logs: z.coerce.boolean().optional(),
    debug: z.coerce.boolean().optional(),
  })
  .strict()
  .refine((d) => d.mode === 'replay_dead_letter' || !!d.target_url || (Array.isArray(d.targets) && d.targets.length > 0), {
    message: 'Provide target_url or non-empty targets[]',
  });

export function parseInput(raw: unknown): SentinelInput {
  const parsed = rawInputSchema.parse(raw ?? {});

  const mode = parsed.mode ?? 'monitor';

  const timeout_secs = parsed.timeout_secs ?? 30;
  const max_retries = parsed.max_retries ?? 3;
  const retry_backoff_ms = parsed.retry_backoff_ms ?? 1000;

  const proxy_configuration = parsed.proxy_configuration;
  const ignore_regex_presets = parsed.ignore_regex_presets ?? [];
  const expandedPresetRegexes = expandIgnoreRegexPresets(ignore_regex_presets);
  const ignore_regexes = [...expandedPresetRegexes, ...(parsed.ignore_regexes ?? [])];
  const fields = parsed.fields ?? [];
  const ignore_json_paths = parsed.ignore_json_paths ?? [];

  function assertUniqueFieldNames(items: Array<{ name: string }>, label: string): void {
    const names = new Set<string>();
    for (const f of items) {
      const key = f.name;
      if (names.has(key)) throw new Error(`Duplicate field name in ${label}: ${key}`);
      names.add(key);
    }
  }

  assertUniqueFieldNames(fields, 'fields[]');

  const targets = [];
  if (parsed.target_url) {
    targets.push({ target_url: normalizeHttpUrl(parsed.target_url) });
  }
  for (const t of parsed.targets ?? []) {
    const tFields = t.fields ?? [];
    assertUniqueFieldNames(tFields, `targets[].fields (${t.target_url})`);
    targets.push({
      target_url: normalizeHttpUrl(t.target_url),
      selector: t.selector,
      fields: t.fields,
      ignore_json_paths: t.ignore_json_paths,
    });
  }

  const primaryTargetUrl = targets[0]?.target_url;
  if (!primaryTargetUrl && mode === 'monitor') {
    // Should be prevented by schema refine, but keep a defensive runtime guard.
    throw new Error('Provide target_url or non-empty targets[]');
  }

  return {
    mode,
    target_url: primaryTargetUrl ?? 'https://example.com/',
    selector: parsed.selector,
    targets,
    rendering_mode: parsed.rendering_mode ?? 'static',
    wait_until: parsed.wait_until ?? 'domcontentloaded',
    wait_for_selector: parsed.wait_for_selector,
    wait_for_selector_timeout_secs: parsed.wait_for_selector_timeout_secs ?? 10,
    fetch_headers: parsed.fetch_headers ?? {},
    proxy_configuration: proxy_configuration
      ? {
          use_apify_proxy: proxy_configuration.use_apify_proxy,
          apify_proxy_groups: proxy_configuration.apify_proxy_groups,
          apify_proxy_country: proxy_configuration.apify_proxy_country,
          proxy_urls: proxy_configuration.proxy_urls,
        }
      : undefined,
    target_domain_allowlist: parsed.target_domain_allowlist ?? [],
    target_domain_denylist: parsed.target_domain_denylist ?? [],
    webhook_url: normalizeHttpUrl(parsed.webhook_url),
    webhook_headers: parsed.webhook_headers ?? {},
    webhook_domain_allowlist: parsed.webhook_domain_allowlist ?? [],
    webhook_domain_denylist: parsed.webhook_domain_denylist ?? [],
    webhook_secret: parsed.webhook_secret,
    baseline_mode: parsed.baseline_mode ?? 'store_only',
    state_store_name: parsed.state_store_name ?? 'sentinel-state',
    dead_letter_dataset_name: parsed.dead_letter_dataset_name ?? 'sentinel-dead-letter',
    replay_limit: parsed.replay_limit ?? 100,
    replay_use_stored_webhook_url: parsed.replay_use_stored_webhook_url ?? true,
    replay_dry_run: parsed.replay_dry_run ?? false,
    history_dataset_name: parsed.history_dataset_name ?? 'sentinel-history',
    history_mode: parsed.history_mode ?? 'changes_only',

    timeout_secs,
    max_retries,
    retry_backoff_ms,

    fetch_timeout_secs: parsed.fetch_timeout_secs ?? timeout_secs,
    fetch_connect_timeout_secs: parsed.fetch_connect_timeout_secs ?? Math.min(10, parsed.fetch_timeout_secs ?? timeout_secs),
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
    politeness_delay_ms: parsed.politeness_delay_ms ?? 0,
    politeness_jitter_ms: parsed.politeness_jitter_ms ?? 0,
    max_concurrency: parsed.max_concurrency ?? 1,
    max_payload_bytes: parsed.max_payload_bytes ?? 250_000,
    reset_baseline: parsed.reset_baseline ?? false,
    min_text_length: parsed.min_text_length ?? 0,
    on_empty_snapshot: parsed.on_empty_snapshot ?? 'error',
    min_change_ratio: parsed.min_change_ratio ?? 0,
    fields,
    ignore_json_paths,

    ignore_selectors: parsed.ignore_selectors ?? [],
    ignore_attributes: parsed.ignore_attributes ?? [],
    ignore_regexes,
    ignore_regex_presets,
    redact_logs: parsed.redact_logs ?? true,
    debug: parsed.debug ?? false,
  };
}
