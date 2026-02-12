import { describe, expect, it } from 'vitest';
import { computeTextChange } from '../src/diff.js';
import type { Snapshot } from '../src/types.js';

function snap(text: string, contentHash: string): Snapshot {
  return {
    url: 'https://example.com',
    fetchedAt: new Date().toISOString(),
    statusCode: 200,
    text,
    contentHash,
  };
}

describe('computeTextChange', () => {
  it('returns null when hashes match', () => {
    const prev = snap('a', 'h');
    const curr = snap('b', 'h');
    expect(computeTextChange(prev, curr)).toBeNull();
  });

  it('computes delta for short numeric strings', () => {
    const prev = snap('$49.99', 'h1');
    const curr = snap('$45.00', 'h2');
    const change = computeTextChange(prev, curr);
    expect(change).not.toBeNull();
    expect(change?.delta).toBeCloseTo(-4.99, 2);
  });
});

