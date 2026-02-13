export type BaselineMode = 'store_only' | 'notify';

export type HistoryMode = 'none' | 'changes_only' | 'all_events';

export type RunMode = 'monitor' | 'replay_dead_letter';

export type RenderingMode = 'static' | 'playwright';

export type WaitUntil = 'domcontentloaded' | 'load' | 'networkidle';

export type OnEmptySnapshotBehavior = 'error' | 'treat_as_change' | 'ignore';

export type IgnoreRegexPreset = 'timestamps' | 'uuids' | 'tokens';

export type SelectorAggregationMode = 'first' | 'all';

export type WhitespaceMode = 'collapse' | 'preserve_lines';

export type UnicodeNormalization = 'none' | 'NFKC';

export type RobotsTxtMode = 'ignore' | 'respect';

export type WebhookDeliveryMode = 'all' | 'any';

export type FieldSpec =
  | {
      name: string;
      selector: string;
      type: 'text';
    }
  | {
      name: string;
      selector: string;
      type: 'attribute';
      attribute: string;
    };

export type ProxyConfigurationInput = {
  use_apify_proxy?: boolean;
  apify_proxy_groups?: string[];
  apify_proxy_country?: string;
  proxy_urls?: string[];
};

export type CookieSpec = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
};

export type TargetInput = {
  target_url: string;
  selector?: string;
  fields?: FieldSpec[];
  ignore_json_paths?: string[];
};

export type SentinelInput = {
  mode: RunMode;
  target_url: string;
  selector?: string;
  targets: TargetInput[];
  rendering_mode: RenderingMode;
  wait_until: WaitUntil;
  wait_for_selector?: string;
  wait_for_selector_timeout_secs: number;
  playwright_block_resources: boolean;
  screenshot_on_change: boolean;
  screenshot_scope: 'full_page' | 'selector';
  screenshot_selector?: string;
  fetch_headers: Record<string, string>;
  target_method: string;
  target_body?: string;
  target_cookies: CookieSpec[];
  robots_txt_mode: RobotsTxtMode;
  block_page_regexes: string[];
  proxy_configuration?: ProxyConfigurationInput;
  target_domain_allowlist: string[];
  target_domain_denylist: string[];
  webhook_url: string; // Backwards-compat: primary webhook URL (first of webhook_urls).
  webhook_urls: string[];
  webhook_delivery_mode: WebhookDeliveryMode;
  webhook_method: string;
  webhook_content_type: string;
  webhook_headers: Record<string, string>;
  webhook_domain_allowlist: string[];
  webhook_domain_denylist: string[];
  webhook_secret?: string;
  baseline_mode: BaselineMode;
  state_store_name: string;
  compress_snapshots: boolean;
  snapshot_history_limit: number;
  dead_letter_dataset_name: string;
  replay_limit: number;
  replay_use_stored_webhook_url: boolean;
  replay_dry_run: boolean;
  history_dataset_name: string;
  history_mode: HistoryMode;
  artifact_store_name: string;
  store_debug_artifacts: boolean;

  // Legacy shared settings (kept for backwards compatibility).
  timeout_secs: number;
  max_retries: number;
  retry_backoff_ms: number;

  // Preferred split settings.
  fetch_timeout_secs: number;
  fetch_connect_timeout_secs: number;
  fetch_max_retries: number;
  fetch_retry_backoff_ms: number;

  webhook_timeout_secs: number;
  webhook_max_retries: number;
  webhook_retry_backoff_ms: number;
  webhook_retry_on_statuses: number[];
  webhook_retry_on_5xx: boolean;
  webhook_max_retry_time_secs?: number;

  max_redirects: number;
  max_content_bytes: number;
  politeness_delay_ms: number;
  politeness_jitter_ms: number;
  schedule_jitter_ms: number;
  max_concurrency: number;
  max_payload_bytes: number;
  reset_baseline: boolean;
  min_text_length: number;
  on_empty_snapshot: OnEmptySnapshotBehavior;
  min_change_ratio: number;
  include_unified_diff: boolean;
  unified_diff_context_lines: number;
  unified_diff_max_chars: number;
  selector_aggregation_mode: SelectorAggregationMode;
  whitespace_mode: WhitespaceMode;
  unicode_normalization: UnicodeNormalization;
  fields: FieldSpec[];
  ignore_json_paths: string[];
  ignore_selectors: string[];
  ignore_attributes: string[];
  ignore_regexes: string[];
  ignore_regex_presets: IgnoreRegexPreset[];
  allow_localhost: boolean;
  redact_logs: boolean;
  debug: boolean;
  structured_logs: boolean;

  notify_on_no_change: boolean;
  notify_on_fetch_failure: boolean;
  fetch_failure_debounce_secs: number;

  webhook_circuit_breaker_enabled: boolean;
  webhook_circuit_failure_threshold: number;
  webhook_circuit_cooldown_secs: number;
};

export type Snapshot = {
  url: string;
  selector?: string;
  fetchedAt: string;
  statusCode: number;
  mode?: 'text' | 'fields' | 'json';
  finalUrl?: string;
  redirectCount?: number;
  bytesRead?: number;
  fetchDurationMs?: number;
  fetchAttempts?: number;
  notModified?: boolean;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  text: string;
  html?: string;
  contentHash: string;
};

export type ArtifactRef = {
  store_name: string;
  key: string;
  content_type: string;
  bytes: number;
};

export type WebhookArtifacts = {
  debug?: {
    previous_snapshot?: ArtifactRef;
    current_snapshot?: ArtifactRef;
  };
  screenshots?: {
    before?: ArtifactRef;
    after?: ArtifactRef;
    scope?: 'full_page' | 'selector';
    selector?: string;
  };
};

export type WebhookEvent = 'CHANGE_DETECTED' | 'BASELINE_STORED' | 'NO_CHANGE' | 'FETCH_FAILED';

export type ChangePayload = {
  schema_version: 1;
  event_id: string;
  event: 'CHANGE_DETECTED' | 'BASELINE_STORED';
  url: string;
  selector?: string;
  timestamp: string;
  summary?: string;
  payload_truncated?: boolean;
  artifacts?: WebhookArtifacts;
  changes?: {
    text?: {
      old: string;
      new: string;
      delta?: number;
      patch?: string;
      patch_truncated?: boolean;
    };
    fields?: Record<
      string,
      {
        old: string;
        new: string;
        delta?: number;
      }
    >;
    json?: {
      diffs: Array<{
        path: string;
        op: 'add' | 'remove' | 'replace';
        old?: unknown;
        new?: unknown;
      }>;
    };
  };
  previous?: Pick<Snapshot, 'contentHash' | 'fetchedAt'>;
  current: Pick<Snapshot, 'contentHash' | 'fetchedAt'>;
};

export type NoChangePayload = {
  schema_version: 1;
  event_id: string;
  event: 'NO_CHANGE';
  url: string;
  selector?: string;
  timestamp: string;
  artifacts?: WebhookArtifacts;
  previous: Pick<Snapshot, 'contentHash' | 'fetchedAt'>;
  current: Pick<Snapshot, 'contentHash' | 'fetchedAt'>;
};

export type FetchFailedPayload = {
  schema_version: 1;
  event_id: string;
  event: 'FETCH_FAILED';
  url: string;
  selector?: string;
  timestamp: string;
  artifacts?: WebhookArtifacts;
  previous?: Pick<Snapshot, 'contentHash' | 'fetchedAt'>;
  error: { name: string; message: string; statusCode?: number; attempts?: number; durationMs?: number };
};

export type WebhookPayload = ChangePayload | NoChangePayload | FetchFailedPayload;
