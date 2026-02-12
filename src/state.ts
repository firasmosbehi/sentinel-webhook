import { sha256Hex } from './hash.js';

export function makeStateKey(targetUrl: string, selector?: string): string {
  const keyMaterial = JSON.stringify({ targetUrl, selector: selector ?? null });
  // Keep keys short and KV-safe.
  return `snapshot-${sha256Hex(keyMaterial).slice(0, 32)}`;
}
