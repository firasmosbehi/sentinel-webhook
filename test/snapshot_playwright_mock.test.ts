import { describe, expect, it, vi } from 'vitest';

describe('buildSnapshot (playwright mode)', () => {
  it('uses selector as default wait_for_selector and returns a snapshot', async () => {
    vi.resetModules();

    const nav = {
      status: () => 200,
      headers: () => ({ 'content-type': 'text/html; charset=utf-8' }) as Record<string, string>,
      url: () => 'https://1.1.1.1/',
      request: () => ({ redirectedFrom: () => null }),
      text: async () => '',
    };

    const page = {
      route: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(nav),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      content: vi.fn().mockResolvedValue('<html><body><h1>Hello</h1></body></html>'),
    };

    const context = {
      newPage: vi.fn().mockResolvedValue(page),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const browser = {
      newContext: vi.fn().mockResolvedValue(context),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const chromium = {
      launch: vi.fn().mockResolvedValue(browser),
    };

    vi.doMock('playwright', () => ({ chromium }));

    const { parseInput } = await import('../src/input.js');
    const { buildSnapshot } = await import('../src/snapshot.js');

    const input = parseInput({
      target_url: 'https://1.1.1.1/',
      webhook_url: 'https://example.com/webhook',
      rendering_mode: 'playwright',
      selector: 'h1',
      fetch_max_retries: 0,
    });

    const snap = await buildSnapshot(input, null);
    expect(page.waitForSelector).toHaveBeenCalledWith('h1', { timeout: input.wait_for_selector_timeout_secs * 1000 });
    expect(snap.mode).toBe('text');
    expect(snap.text).toBe('Hello');
  });
});

