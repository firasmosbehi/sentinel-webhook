import { gunzipSync, gzipSync } from 'node:zlib';
import type { Snapshot } from './types.js';

export type CompressedSnapshot = Omit<Snapshot, 'text' | 'html'> & {
  compression: 'gzip-base64';
  text_gzip_base64: string;
  html_gzip_base64?: string;
  text_len: number;
  html_len?: number;
};

export type StoredSnapshot = Snapshot | CompressedSnapshot;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isCompressedSnapshot(value: unknown): value is CompressedSnapshot {
  if (!isRecord(value)) return false;
  if (value.compression !== 'gzip-base64') return false;
  if (typeof value.text_gzip_base64 !== 'string') return false;
  return true;
}

export function decodeStoredSnapshot(value: unknown): Snapshot {
  if (!isCompressedSnapshot(value)) return value as Snapshot;

  const text = gunzipSync(Buffer.from(value.text_gzip_base64, 'base64')).toString('utf8');
  const html = value.html_gzip_base64
    ? gunzipSync(Buffer.from(value.html_gzip_base64, 'base64')).toString('utf8')
    : undefined;

  const out: Snapshot = {
    ...(value as Omit<CompressedSnapshot, 'compression' | 'text_gzip_base64' | 'html_gzip_base64' | 'text_len' | 'html_len'>),
    text,
    html,
  };
  return out;
}

export function encodeSnapshotForStore(snapshot: Snapshot, compress: boolean): StoredSnapshot {
  if (!compress) return snapshot;

  const { text, html, ...rest } = snapshot;

  const gzText = gzipSync(Buffer.from(text, 'utf8'));
  const textB64 = gzText.toString('base64');

  const htmlRaw = html ?? null;
  const gzHtml = htmlRaw ? gzipSync(Buffer.from(htmlRaw, 'utf8')) : null;
  const htmlB64 = gzHtml ? gzHtml.toString('base64') : null;

  // Only store compressed if it meaningfully reduces size.
  const origLen = text.length + (htmlRaw ? htmlRaw.length : 0);
  const compLen = textB64.length + (htmlB64 ? htmlB64.length : 0);
  if (compLen >= origLen) return snapshot;

  const out: CompressedSnapshot = {
    ...rest,
    compression: 'gzip-base64',
    text_gzip_base64: textB64,
    html_gzip_base64: htmlB64 ?? undefined,
    text_len: text.length,
    html_len: htmlRaw ? htmlRaw.length : undefined,
  };

  return out;
}
