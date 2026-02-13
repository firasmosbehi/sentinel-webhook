import type { KeyValueStore } from 'apify';
import type { Snapshot } from './types.js';

export type SnapshotHistoryEntry = {
  fetchedAt: string;
  contentHash: string;
  statusCode: number;
  finalUrl?: string;
  redirectCount?: number;
  bytesRead?: number;
  fetchDurationMs?: number;
  fetchAttempts?: number;
  notModified?: boolean;
  mode?: Snapshot['mode'];
};

export function snapshotHistoryKey(stateKey: string): string {
  return `history-${stateKey}`;
}

export async function appendSnapshotHistory(
  kv: KeyValueStore,
  stateKey: string,
  snapshot: Snapshot,
  limit: number,
): Promise<void> {
  const max = Math.max(0, Math.floor(limit));
  if (max <= 0) return;

  const key = snapshotHistoryKey(stateKey);
  const existing = (await kv.getValue<SnapshotHistoryEntry[]>(key)) ?? [];
  const list = Array.isArray(existing) ? existing : [];

  const entry: SnapshotHistoryEntry = {
    fetchedAt: snapshot.fetchedAt,
    contentHash: snapshot.contentHash,
    statusCode: snapshot.statusCode,
    finalUrl: snapshot.finalUrl,
    redirectCount: snapshot.redirectCount,
    bytesRead: snapshot.bytesRead,
    fetchDurationMs: snapshot.fetchDurationMs,
    fetchAttempts: snapshot.fetchAttempts,
    notModified: snapshot.notModified,
    mode: snapshot.mode,
  };

  const next = [...list, entry].slice(-max);
  await kv.setValue(key, next);
}

