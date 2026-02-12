import { describe, expect, it } from 'vitest';
import { limitPayloadBytes } from '../src/payload_limit.js';
import type { ChangePayload } from '../src/types.js';

function makeChangePayload(oldText: string, newText: string): ChangePayload {
  return {
    schema_version: 1,
    event_id: 'evt_1',
    event: 'CHANGE_DETECTED',
    url: 'https://example.com',
    selector: 'h1',
    timestamp: '2026-01-01T00:00:00.000Z',
    payload_truncated: false,
    changes: {
      text: { old: oldText, new: newText },
    },
    previous: { contentHash: 'prev', fetchedAt: '2026-01-01T00:00:00.000Z' },
    current: { contentHash: 'curr', fetchedAt: '2026-01-01T00:00:00.000Z' },
  };
}

describe('limitPayloadBytes', () => {
  it('truncates old/new text to fit max bytes', () => {
    const payload = makeChangePayload('a'.repeat(10_000), 'b'.repeat(10_000));
    const limited = limitPayloadBytes(payload, 800);

    const json = JSON.stringify(limited.payload);
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(800);
    expect(limited.truncated).toBe(true);
    expect(limited.payload.payload_truncated).toBe(true);
    expect(limited.payload.event_id).toBe('evt_1');
    expect(limited.payload.changes?.text.old.length).toBeLessThan(payload.changes?.text.old.length ?? 0);
    expect(limited.payload.changes?.text.new.length).toBeLessThan(payload.changes?.text.new.length ?? 0);
  });

  it('throws if payload has no changes and exceeds max bytes', () => {
    const payload: ChangePayload = {
      schema_version: 1,
      event_id: 'evt_2',
      event: 'BASELINE_STORED',
      url: `https://example.com/?q=${'x'.repeat(5_000)}`,
      selector: undefined,
      timestamp: '2026-01-01T00:00:00.000Z',
      current: { contentHash: 'curr', fetchedAt: '2026-01-01T00:00:00.000Z' },
    };

    expect(() => limitPayloadBytes(payload, 200)).toThrow();
  });
});

