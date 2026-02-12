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

