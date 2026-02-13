import { describe, expect, it } from 'vitest';
import { diffJson } from '../src/json_diff.js';

describe('diffJson', () => {
  it('diffs nested objects deterministically', () => {
    const prev = { a: 1, b: { c: 2 } };
    const curr = { a: 2, b: { c: 2, d: 3 } };

    const diffs = diffJson(prev, curr);
    expect(diffs).toEqual([
      { path: '/a', op: 'replace', old: 1, new: 2 },
      { path: '/b/d', op: 'add', new: 3 },
    ]);
  });

  it('supports ignore JSON pointer prefixes', () => {
    const prev = { a: 1, b: { c: 2 } };
    const curr = { a: 2, b: { c: 999 } };

    const diffs = diffJson(prev, curr, ['/b']);
    expect(diffs).toEqual([{ path: '/a', op: 'replace', old: 1, new: 2 }]);
  });

  it('escapes JSON pointer segments', () => {
    const prev = { 'a/b': 1, 'til~de': 1 };
    const curr = { 'a/b': 2, 'til~de': 1 };

    const diffs = diffJson(prev, curr);
    expect(diffs).toEqual([{ path: '/a~1b', op: 'replace', old: 1, new: 2 }]);
  });
});

