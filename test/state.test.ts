import { describe, expect, it } from 'vitest';
import { makeStateKeyV1, makeStateKeyV2 } from '../src/state.js';

describe('state keys', () => {
  it('v1 is stable for same url+selector', () => {
    const a = makeStateKeyV1('https://example.com', 'h1');
    const b = makeStateKeyV1('https://example.com', 'h1');
    expect(a).toBe(b);
  });

  it('v2 changes when ignore rules change', () => {
    const base = {
      targetUrl: 'https://example.com',
      selector: 'h1',
      renderingMode: 'static',
      fetchHeaders: {},
      fields: [],
      ignoreJsonPaths: [],
      ignoreSelectors: [],
      ignoreAttributes: [],
      ignoreRegexes: [],
    };

    const a = makeStateKeyV2(base);
    const b = makeStateKeyV2({ ...base, ignoreRegexes: ['foo'] });
    expect(a).not.toBe(b);
  });

  it('v2 changes when rendering mode changes', () => {
    const base = {
      targetUrl: 'https://example.com',
      selector: 'h1',
      renderingMode: 'static',
      fetchHeaders: {},
      fields: [],
      ignoreJsonPaths: [],
      ignoreSelectors: [],
      ignoreAttributes: [],
      ignoreRegexes: [],
    };

    const a = makeStateKeyV2(base);
    const b = makeStateKeyV2({ ...base, renderingMode: 'playwright' });
    expect(a).not.toBe(b);
  });
});
