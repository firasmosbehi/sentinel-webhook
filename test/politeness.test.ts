import { afterEach, describe, expect, it, vi } from 'vitest';
import { waitForPoliteness } from '../src/politeness.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForPoliteness', () => {
  it('serializes calls per-host with the configured delay', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const url = 'https://politeness.example/path';

    const done: number[] = [];
    const p1 = waitForPoliteness(url, 100, 0).then(() => done.push(Date.now()));
    const p2 = waitForPoliteness(url, 100, 0).then(() => done.push(Date.now()));

    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(done.length).toBe(2);
    expect(done[0]).toBe(1767225600000);
    expect(done[1]).toBeGreaterThanOrEqual(done[0] + 100);
  });

  it('returns immediately when delay is 0', async () => {
    await expect(waitForPoliteness('https://example.com', 0, 0)).resolves.toBeUndefined();
  });
});
