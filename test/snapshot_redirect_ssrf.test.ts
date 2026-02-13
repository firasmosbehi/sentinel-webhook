import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseInput } from '../src/input.js';
import { buildSnapshot } from '../src/snapshot.js';

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('buildSnapshot redirect safety', () => {
  it('blocks redirects to localhost/private IPs', async () => {
    const input = parseInput({
      target_url: 'https://example.com',
      webhook_url: 'https://example.com/webhook',
      fetch_max_retries: 0,
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'http://127.0.0.1/' } }));

    await expect(buildSnapshot(input, null)).rejects.toThrow();
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1);
  });

  it('blocks redirects to non-http protocols', async () => {
    const input = parseInput({
      target_url: 'https://example.com',
      webhook_url: 'https://example.com/webhook',
      fetch_max_retries: 0,
    });

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 302, headers: { location: 'file:///etc/passwd' } }));

    await expect(buildSnapshot(input, null)).rejects.toThrow();
  });
});

