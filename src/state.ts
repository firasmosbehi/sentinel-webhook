import { sha256Hex } from './hash.js';
import type {
  CookieSpec,
  FieldSpec,
  RobotsTxtMode,
  SelectorAggregationMode,
  UnicodeNormalization,
  WhitespaceMode,
} from './types.js';

export type StateKeyV2Input = {
  targetUrl: string;
  selector?: string;
  renderingMode: string;
  waitUntil: string;
  waitForSelector?: string;
  waitForSelectorTimeoutSecs: number;
  fetchHeaders: Record<string, string>;
  targetMethod?: string;
  targetBody?: string;
  targetCookies?: CookieSpec[];
  robotsTxtMode?: RobotsTxtMode;
  blockPageRegexes?: string[];
  selectorAggregationMode?: SelectorAggregationMode;
  whitespaceMode?: WhitespaceMode;
  unicodeNormalization?: UnicodeNormalization;
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
  const targetMethod = (input.targetMethod ?? 'GET').toUpperCase();
  const targetBodyHash = input.targetBody ? sha256Hex(input.targetBody) : null;
  const targetCookies =
    input.targetCookies && input.targetCookies.length > 0
      ? [...input.targetCookies]
          .map((c) => ({
            name: c.name,
            value: c.value,
            domain: c.domain ?? null,
            path: c.path ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : null;

  const keyMaterial = JSON.stringify({
    v: 2,
    targetUrl: input.targetUrl,
    selector: input.selector ?? null,
    renderingMode: input.renderingMode,
    waitUntil: input.waitUntil,
    waitForSelector: input.waitForSelector ?? null,
    waitForSelectorTimeoutSecs: input.waitForSelectorTimeoutSecs,
    fetchHeaders: headers,
    ...(targetMethod !== 'GET' ? { targetMethod } : {}),
    ...(targetBodyHash ? { targetBodyHash } : {}),
    ...(targetCookies ? { targetCookies } : {}),
    ...(input.robotsTxtMode && input.robotsTxtMode !== 'ignore' ? { robotsTxtMode: input.robotsTxtMode } : {}),
    ...(input.blockPageRegexes && input.blockPageRegexes.length > 0 ? { blockPageRegexes: [...input.blockPageRegexes].sort() } : {}),
    ...(input.selectorAggregationMode && input.selectorAggregationMode !== 'all'
      ? { selectorAggregationMode: input.selectorAggregationMode }
      : {}),
    ...(input.whitespaceMode && input.whitespaceMode !== 'collapse' ? { whitespaceMode: input.whitespaceMode } : {}),
    ...(input.unicodeNormalization && input.unicodeNormalization !== 'none'
      ? { unicodeNormalization: input.unicodeNormalization }
      : {}),
    fields,
    ignoreJsonPaths,
    ignoreSelectors: input.ignoreSelectors,
    ignoreAttributes: input.ignoreAttributes,
    ignoreRegexes: input.ignoreRegexes,
  });

  return `snapshot-${sha256Hex(keyMaterial).slice(0, 32)}`;
}
