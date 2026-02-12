export type BaselineMode = 'store_only' | 'notify';

export type SentinelInput = {
  target_url: string;
  selector?: string;
  webhook_url: string;
  webhook_headers: Record<string, string>;
  webhook_secret?: string;
  baseline_mode: BaselineMode;
  state_store_name: string;
  timeout_secs: number;
  max_retries: number;
  retry_backoff_ms: number;
  ignore_selectors: string[];
  ignore_regexes: string[];
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
  event: 'CHANGE_DETECTED' | 'BASELINE_STORED';
  url: string;
  selector?: string;
  timestamp: string;
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
