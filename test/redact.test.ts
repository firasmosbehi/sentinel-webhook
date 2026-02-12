import { describe, expect, it } from 'vitest';
import { redactUrl, truncate } from '../src/redact.js';

describe('redactUrl', () => {
  it('strips credentials and fragments and redacts sensitive query params', () => {
    const out = redactUrl('https://user:pass@example.com/path?token=abc&foo=bar#frag');
    expect(out).toBe('https://example.com/path?token=REDACTED&foo=bar');
  });
});

describe('truncate', () => {
  it('truncates long text with ASCII ellipsis', () => {
    const out = truncate('abcdef', 5);
    expect(out.truncated).toBe(true);
    expect(out.text).toBe('ab...');
  });
});

