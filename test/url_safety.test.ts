import { describe, expect, it } from 'vitest';
import { assertSafeHttpUrl } from '../src/url_safety.js';

describe('assertSafeHttpUrl', () => {
  it('blocks localhost / private IPv4', async () => {
    await expect(assertSafeHttpUrl('http://127.0.0.1', 't')).rejects.toThrow();
    await expect(assertSafeHttpUrl('http://10.0.0.1', 't')).rejects.toThrow();
    await expect(assertSafeHttpUrl('http://192.168.1.1', 't')).rejects.toThrow();
  });

  it('blocks loopback IPv6', async () => {
    await expect(assertSafeHttpUrl('http://[::1]/', 't')).rejects.toThrow();
  });

  it('allows a public IP literal', async () => {
    await expect(assertSafeHttpUrl('https://1.1.1.1/', 't')).resolves.toBeUndefined();
  });
});

