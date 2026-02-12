import { describe, expect, it } from 'vitest';
import { computeEventId } from '../src/event_id.js';

describe('computeEventId', () => {
  it('is deterministic for the same inputs', () => {
    const a = computeEventId({
      event: 'CHANGE_DETECTED',
      url: 'https://example.com',
      selector: 'h1',
      previousHash: 'prev',
      currentHash: 'curr',
    });
    const b = computeEventId({
      event: 'CHANGE_DETECTED',
      url: 'https://example.com',
      selector: 'h1',
      previousHash: 'prev',
      currentHash: 'curr',
    });
    expect(a).toBe(b);
  });

  it('changes when hashes change', () => {
    const a = computeEventId({
      event: 'CHANGE_DETECTED',
      url: 'https://example.com',
      selector: 'h1',
      previousHash: 'prev',
      currentHash: 'curr',
    });
    const b = computeEventId({
      event: 'CHANGE_DETECTED',
      url: 'https://example.com',
      selector: 'h1',
      previousHash: 'prev',
      currentHash: 'curr2',
    });
    expect(a).not.toBe(b);
  });
});

