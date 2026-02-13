import { sha256Hex } from './hash.js';

export type StateKeyV2Input = {
  targetUrl: string;
  selector?: string;
  renderingMode: string;
  fetchHeaders: Record<string, string>;
  ignoreSelectors: string[];
  ignoreAttributes: string[];
  ignoreRegexes: string[];
};

export function makeStateKeyV1(targetUrl: string, selector?: string): string {
  const keyMaterial = JSON.stringify({ v: 1, targetUrl, selector: selector ?? null });
  // Keep keys short and KV-safe.
  return `snapshot-${sha256Hex(keyMaterial).slice(0, 32)}`;
}

export function makeStateKeyV2(input: StateKeyV2Input): string {
  const headers = Object.keys(input.fetchHeaders)
    .sort()
    .map((k) => [k.toLowerCase(), input.fetchHeaders[k]] as const);

  const keyMaterial = JSON.stringify({
    v: 2,
    targetUrl: input.targetUrl,
    selector: input.selector ?? null,
    renderingMode: input.renderingMode,
    fetchHeaders: headers,
    ignoreSelectors: input.ignoreSelectors,
    ignoreAttributes: input.ignoreAttributes,
    ignoreRegexes: input.ignoreRegexes,
  });

  return `snapshot-${sha256Hex(keyMaterial).slice(0, 32)}`;
}
