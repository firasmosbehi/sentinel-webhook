import { sha256Hex } from './hash.js';

export type EventIdInput = {
  event: 'CHANGE_DETECTED' | 'BASELINE_STORED';
  url: string;
  selector?: string;
  previousHash?: string;
  currentHash: string;
};

export function computeEventId(input: EventIdInput): string {
  // Stable, deterministic input for idempotency across retries/reruns.
  const stable = JSON.stringify({
    v: 1,
    event: input.event,
    url: input.url,
    selector: input.selector ?? null,
    previousHash: input.previousHash ?? null,
    currentHash: input.currentHash,
  });

  return sha256Hex(stable);
}

export type RunScopedEventIdInput = {
  event: 'NO_CHANGE' | 'FETCH_FAILED';
  runId: string;
  url: string;
  selector?: string;
  currentHash?: string;
  signature?: string;
};

export function computeRunScopedEventId(input: RunScopedEventIdInput): string {
  // Unique per run (or per debounced emission), but stable across webhook retries.
  const stable = JSON.stringify({
    v: 2,
    event: input.event,
    runId: input.runId,
    url: input.url,
    selector: input.selector ?? null,
    currentHash: input.currentHash ?? null,
    signature: input.signature ?? null,
  });

  return sha256Hex(stable);
}
