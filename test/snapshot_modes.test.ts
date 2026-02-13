import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInput } from '../src/input.js';
import { buildSnapshot } from '../src/snapshot.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('buildSnapshot modes', () => {
  it('extracts fields[] and stores stable JSON text', async () => {
    const input = parseInput({
      target_url: 'https://example.com',
      webhook_url: 'https://example.com/webhook',
      fetch_max_retries: 0,
      fields: [{ name: 'price', selector: '.price', type: 'text' }],
    });

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response('<div class="price">$49.99</div>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    );

    const snap = await buildSnapshot(input, null);
    expect(snap.mode).toBe('fields');
    expect(snap.text).toBe('{"price":"$49.99"}');
  });

  it('parses application/json and applies ignore_json_paths', async () => {
    const input = parseInput({
      target_url: 'https://example.com/api',
      webhook_url: 'https://example.com/webhook',
      fetch_max_retries: 0,
      ignore_json_paths: ['/meta/timestamp'],
    });

    globalThis.fetch = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ meta: { timestamp: '2026-05-12T10:00:00Z', session: 'abc' }, data: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      }),
    );

    const snap = await buildSnapshot(input, null);
    expect(snap.mode).toBe('json');
    expect(snap.text).toBe('{"data":1,"meta":{"session":"abc"}}');
  });
});

