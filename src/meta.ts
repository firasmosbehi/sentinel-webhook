import type { WebhookDeliveryError } from './webhook.js';

export type TargetMeta = {
  last_run_at?: string;
  last_outcome?: string;

  // Last successful snapshot fetch/extraction (even if baseline wasn't advanced due to webhook failure).
  last_success_snapshot_at?: string;
  last_success_content_hash?: string;
  last_success_status_code?: number;
  last_success_final_url?: string;

  // Webhook circuit breaker state.
  webhook_consecutive_failures?: number;
  webhook_circuit_open_until?: string; // ISO timestamp
  webhook_last_failure_at?: string;
  webhook_last_failure_status?: number;
  webhook_last_failure_message?: string;

  // Notification debouncing.
  last_no_change_notified_at?: string;
  last_fetch_failure_notified_at?: string;
  last_fetch_failure_signature?: string;
};

export function metaKeyForStateKey(stateKey: string): string {
  return `meta-${stateKey}`;
}

export function isCircuitOpen(meta: TargetMeta | null, now: Date = new Date()): boolean {
  const until = meta?.webhook_circuit_open_until;
  if (!until) return false;
  const t = Date.parse(until);
  if (!Number.isFinite(t)) return false;
  return now.getTime() < t;
}

export function recordRunMeta(meta: TargetMeta | null, outcome: string, now: Date = new Date()): TargetMeta {
  return {
    ...(meta ?? {}),
    last_run_at: now.toISOString(),
    last_outcome: outcome,
  };
}

export function recordWebhookSuccess(meta: TargetMeta | null): TargetMeta {
  const next: TargetMeta = { ...(meta ?? {}) };
  next.webhook_consecutive_failures = 0;
  next.webhook_circuit_open_until = undefined;
  next.webhook_last_failure_at = undefined;
  next.webhook_last_failure_status = undefined;
  next.webhook_last_failure_message = undefined;
  return next;
}

export function recordWebhookFailure(
  meta: TargetMeta | null,
  err: unknown,
  opts: { threshold: number; cooldownSecs: number; now?: Date },
): { meta: TargetMeta; tripped: boolean } {
  const now = opts.now ?? new Date();
  const next: TargetMeta = { ...(meta ?? {}) };
  const prev = typeof next.webhook_consecutive_failures === 'number' ? next.webhook_consecutive_failures : 0;
  const failures = prev + 1;
  next.webhook_consecutive_failures = failures;
  next.webhook_last_failure_at = now.toISOString();
  const status = (err as WebhookDeliveryError | undefined)?.statusCode;
  if (typeof status === 'number') next.webhook_last_failure_status = status;
  const message = (err as Error | undefined)?.message;
  if (typeof message === 'string') next.webhook_last_failure_message = message.slice(0, 1000);

  const shouldTrip = failures >= Math.max(1, Math.floor(opts.threshold));
  if (!shouldTrip) return { meta: next, tripped: false };

  const until = new Date(now.getTime() + Math.max(0, Math.floor(opts.cooldownSecs)) * 1000);
  next.webhook_circuit_open_until = until.toISOString();
  return { meta: next, tripped: true };
}
