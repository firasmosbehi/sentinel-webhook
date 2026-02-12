export type BaselineMode = 'store_only' | 'notify';

export type HistoryMode = 'none' | 'changes_only' | 'all_events';

export type SentinelInput = {
  target_url: string;
  selector?: string;
  webhook_url: string;
  webhook_headers: Record<string, string>;
  webhook_secret?: string;
  baseline_mode: BaselineMode;
  state_store_name: string;
  dead_letter_dataset_name: string;
  history_dataset_name: string;
  history_mode: HistoryMode;

  // Legacy shared settings (kept for backwards compatibility).
  timeout_secs: number;
  max_retries: number;
  retry_backoff_ms: number;

  // Preferred split settings.
  fetch_timeout_secs: number;
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
  max_payload_bytes: number;
  reset_baseline: boolean;
  ignore_selectors: string[];
  ignore_regexes: string[];
  redact_logs: boolean;
  debug: boolean;
};

export type Snapshot = {
  url: string;
  selector?: string;
  fetchedAt: string;
  statusCode: number;
  contentType?: string;
  etag?: string;
  lastModified?: string;
  text: string;
  html?: string;
  contentHash: string;
};

export type ChangePayload = {
  schema_version: 1;
  event_id: string;
  event: 'CHANGE_DETECTED' | 'BASELINE_STORED';
  url: string;
  selector?: string;
  timestamp: string;
  payload_truncated?: boolean;
  changes?: {
    text: {
      old: string;
      new: string;
      delta?: number;
    };
  };
  previous?: Pick<Snapshot, 'contentHash' | 'fetchedAt'>;
  current: Pick<Snapshot, 'contentHash' | 'fetchedAt'>;
};
