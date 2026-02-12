import { describe, expect, it, vi } from 'vitest';
import { withRetries } from '../src/retry.js';

describe('withRetries', () => {
  it('respects maxTotalTimeMs', async () => {
    const mockRand = vi.spyOn(Math, 'random').mockReturnValue(0);
    let calls = 0;

    await expect(
      withRetries(
        async () => {
          calls += 1;
          throw new Error('no');
        },
        {
          maxRetries: 10,
          baseBackoffMs: 1000,
          maxTotalTimeMs: 10,
          shouldRetry: () => true,
        },
      ),
    ).rejects.toThrow('no');

    expect(calls).toBe(1);
    mockRand.mockRestore();
  });
});

