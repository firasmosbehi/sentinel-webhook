import type { KeyValueStore } from 'apify';
import { describe, expect, it, vi } from 'vitest';

class MemoryKv {
  private readonly map = new Map<string, unknown>();

  async getValue<T = unknown>(key: string): Promise<T | null> {
    return (this.map.has(key) ? (this.map.get(key) as T) : null) ?? null;
  }

  async setValue(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }

  getRaw(key: string): unknown | null {
    return this.map.has(key) ? (this.map.get(key) as unknown) : null;
  }
}

describe('screenshot mode artifact helpers', () => {
  it('stores before/after screenshots under event-scoped keys and returns refs', async () => {
    vi.resetModules();

    const captureMock = vi.fn().mockResolvedValue({
      png: Buffer.from('after'),
      finalUrl: 'https://example.com/',
    });

    vi.doMock('../src/playwright_screenshot.js', () => ({ capturePlaywrightScreenshot: captureMock }));

    const { parseInput } = await import('../src/input.js');
    const { baselineScreenshotKey, captureAndStoreChangeScreenshots } = await import('../src/screenshot_mode.js');

    const input = parseInput({
      target_url: 'https://example.com/',
      webhook_url: 'https://example.com/webhook',
      rendering_mode: 'playwright',
      screenshot_on_change: true,
      screenshot_scope: 'selector',
      screenshot_selector: '#x',
      fetch_max_retries: 0,
    });

    const store = new MemoryKv();
    await store.setValue(baselineScreenshotKey('state1'), Buffer.from('before'));

    const res = await captureAndStoreChangeScreenshots(input, {
      artifacts: store as unknown as KeyValueStore,
      stateKey: 'state1',
      eventId: 'evt1',
    });

    expect(captureMock).toHaveBeenCalledWith(input, { url: input.target_url, scope: 'selector', selector: '#x' });

    expect(res?.screenshots.before?.key).toBe('artifact-state1-evt1-screenshot_before.png');
    expect(res?.screenshots.after?.key).toBe('artifact-state1-evt1-screenshot_after.png');
    expect(res?.screenshots.scope).toBe('selector');
    expect(res?.screenshots.selector).toBe('#x');

    expect(store.getRaw('artifact-state1-evt1-screenshot_before.png')).toEqual(Buffer.from('before'));
    expect(store.getRaw('artifact-state1-evt1-screenshot_after.png')).toEqual(Buffer.from('after'));
  });

  it('updates the baseline screenshot key', async () => {
    vi.resetModules();

    const { parseInput } = await import('../src/input.js');
    const { baselineScreenshotKey, updateBaselineScreenshot } = await import('../src/screenshot_mode.js');

    const input = parseInput({
      target_url: 'https://example.com/',
      webhook_url: 'https://example.com/webhook',
      rendering_mode: 'playwright',
      screenshot_on_change: true,
      fetch_max_retries: 0,
    });

    const store = new MemoryKv();
    await store.setValue(baselineScreenshotKey('state1'), Buffer.from('old'));

    await updateBaselineScreenshot(input, { artifacts: store as unknown as KeyValueStore, stateKey: 'state1', png: Buffer.from('new') });

    expect(store.getRaw(baselineScreenshotKey('state1'))).toEqual(Buffer.from('new'));
  });
});

