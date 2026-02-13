import { describe, expect, it, vi } from 'vitest';

describe('buildSnapshot (playwright mode, xml content-types)', () => {
  it('uses response body text (nav.text) for application/xml and supports selectors', async () => {
    vi.resetModules();

    const xml = '<rss><channel><title>Hello</title></channel></rss>';

    const nav = {
      status: () => 200,
      headers: () => ({ 'content-type': 'application/xml; charset=utf-8' }) as Record<string, string>,
      url: () => 'https://1.1.1.1/',
      request: () => ({ redirectedFrom: () => null }),
      text: vi.fn().mockResolvedValue(xml),
    };

    const page = {
      route: vi.fn().mockResolvedValue(undefined),
      goto: vi.fn().mockResolvedValue(nav),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      // If this gets used, we'd be parsing HTML instead of the raw XML body.
      content: vi.fn().mockResolvedValue('<html><body><div>Wrong</div></body></html>'),
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
      selector: 'title',
      fetch_max_retries: 0,
    });

    const snap = await buildSnapshot(input, null);
    expect(nav.text).toHaveBeenCalled();
    expect(page.content).not.toHaveBeenCalled();
    expect(snap.mode).toBe('text');
    expect(snap.text).toBe('Hello');
  });
});

