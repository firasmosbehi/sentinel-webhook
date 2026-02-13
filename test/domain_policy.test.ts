import { describe, expect, it } from 'vitest';
import { assertUrlAllowedByDomainPolicy } from '../src/domain_policy.js';

describe('assertUrlAllowedByDomainPolicy', () => {
  it('allows when allowlist is empty', () => {
    expect(() =>
      assertUrlAllowedByDomainPolicy('https://example.com/path', 't', { allowlist: [], denylist: [] }),
    ).not.toThrow();
  });

  it('blocks when denylist matches', () => {
    expect(() =>
      assertUrlAllowedByDomainPolicy('https://example.com', 't', { allowlist: [], denylist: ['example.com'] }),
    ).toThrow();
  });

  it('requires allowlist match when allowlist is set', () => {
    expect(() =>
      assertUrlAllowedByDomainPolicy('https://a.example.com', 't', { allowlist: ['example.com'], denylist: [] }),
    ).toThrow();
  });

  it('supports wildcard subdomain patterns', () => {
    expect(() =>
      assertUrlAllowedByDomainPolicy('https://a.example.com', 't', { allowlist: ['*.example.com'], denylist: [] }),
    ).not.toThrow();
    expect(() =>
      assertUrlAllowedByDomainPolicy('https://example.com', 't', { allowlist: ['*.example.com'], denylist: [] }),
    ).toThrow();
  });

  it('denylist takes precedence over allowlist', () => {
    expect(() =>
      assertUrlAllowedByDomainPolicy('https://a.example.com', 't', {
        allowlist: ['*.example.com'],
        denylist: ['a.example.com'],
      }),
    ).toThrow();
  });
});

