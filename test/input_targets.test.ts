import { describe, expect, it } from 'vitest';
import { parseInput } from '../src/input.js';

describe('parseInput targets[]', () => {
  it('accepts targets[] without target_url and sets target_url to first target', () => {
    const input = parseInput({
      targets: [{ target_url: 'https://a.example.com', selector: 'h1' }, { target_url: 'https://b.example.com' }],
      webhook_url: 'https://example.com/webhook',
    });

    expect(input.target_url).toBe('https://a.example.com/');
    expect(input.targets.length).toBe(2);
    expect(input.targets[0]?.target_url).toBe('https://a.example.com/');
    expect(input.targets[0]?.selector).toBe('h1');
  });

  it('rejects input without target_url or targets[]', () => {
    expect(() => parseInput({ webhook_url: 'https://example.com/webhook' })).toThrow();
  });

  it('validates duplicate field names per target', () => {
    expect(() =>
      parseInput({
        targets: [
          {
            target_url: 'https://a.example.com',
            fields: [
              { name: 'x', selector: '.a', type: 'text' },
              { name: 'x', selector: '.b', type: 'text' },
            ],
          },
        ],
        webhook_url: 'https://example.com/webhook',
      }),
    ).toThrow(/Duplicate field name/);
  });

  it('parses max_concurrency', () => {
    const input = parseInput({
      target_url: 'https://example.com',
      webhook_url: 'https://example.com/webhook',
      max_concurrency: 3,
    });
    expect(input.max_concurrency).toBe(3);
  });
});

