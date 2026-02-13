import { sha256Hex } from './hash.js';
import type { FieldSpec } from './types.js';

export type StateKeyV2Input = {
  targetUrl: string;
  selector?: string;
  renderingMode: string;
  waitUntil: string;
  waitForSelector?: string;
  waitForSelectorTimeoutSecs: number;
  fetchHeaders: Record<string, string>;
  fields: FieldSpec[];
  ignoreJsonPaths: string[];
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

  const fields = input.fields
    .map((f) =>
      f.type === 'text'
        ? { name: f.name, selector: f.selector, type: 'text' as const }
        : { name: f.name, selector: f.selector, type: 'attribute' as const, attribute: f.attribute },
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const ignoreJsonPaths = [...input.ignoreJsonPaths].sort();

  const keyMaterial = JSON.stringify({
    v: 2,
    targetUrl: input.targetUrl,
    selector: input.selector ?? null,
    renderingMode: input.renderingMode,
    waitUntil: input.waitUntil,
    waitForSelector: input.waitForSelector ?? null,
    waitForSelectorTimeoutSecs: input.waitForSelectorTimeoutSecs,
    fetchHeaders: headers,
    fields,
    ignoreJsonPaths,
    ignoreSelectors: input.ignoreSelectors,
    ignoreAttributes: input.ignoreAttributes,
    ignoreRegexes: input.ignoreRegexes,
  });

  return `snapshot-${sha256Hex(keyMaterial).slice(0, 32)}`;
}
