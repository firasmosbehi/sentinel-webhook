import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';

export class UrlSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlSafetyError';
  }
}

const hostnameCache = new Map<string, { ok: boolean; reason?: string }>();

function isPublicIpAddress(address: string): { ok: boolean; reason?: string } {
  let ip: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    ip = ipaddr.parse(address);
  } catch {
    return { ok: false, reason: `Invalid IP address: ${address}` };
  }

  // If IPv6 is actually an IPv4-mapped address, evaluate it as IPv4.
  if (ip.kind() === 'ipv6' && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    const v4 = (ip as ipaddr.IPv6).toIPv4Address();
    const range = v4.range();
    return range === 'unicast' ? { ok: true } : { ok: false, reason: `Blocked IPv4 range (${range}): ${address}` };
  }

  const range = ip.range();
  return range === 'unicast' ? { ok: true } : { ok: false, reason: `Blocked IP range (${range}): ${address}` };
}

async function assertSafeHostname(hostname: string, label: string): Promise<void> {
  const normalized = hostname.replace(/\.$/, '').toLowerCase();
  if (!normalized) throw new UrlSafetyError(`[${label}] Missing hostname`);
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    throw new UrlSafetyError(`[${label}] Blocked hostname: ${hostname}`);
  }

  const cached = hostnameCache.get(normalized);
  if (cached) {
    if (!cached.ok) throw new UrlSafetyError(`[${label}] ${cached.reason ?? 'Blocked hostname'}`);
    return;
  }

  try {
    const records = await lookup(normalized, { all: true, verbatim: true });
    if (records.length === 0) {
      hostnameCache.set(normalized, { ok: false, reason: `Unable to resolve hostname: ${hostname}` });
      throw new UrlSafetyError(`[${label}] Unable to resolve hostname: ${hostname}`);
    }

    for (const rec of records) {
      const verdict = isPublicIpAddress(rec.address);
      if (!verdict.ok) {
        hostnameCache.set(normalized, { ok: false, reason: verdict.reason });
        throw new UrlSafetyError(`[${label}] ${verdict.reason}`);
      }
    }
  } catch (err) {
    if (err instanceof UrlSafetyError) {
      hostnameCache.set(normalized, { ok: false, reason: err.message });
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    hostnameCache.set(normalized, { ok: false, reason: message });
    throw new UrlSafetyError(`[${label}] ${message}`);
  }

  hostnameCache.set(normalized, { ok: true });
}

export async function assertSafeHttpUrl(rawUrl: string, label: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlSafetyError(`[${label}] Invalid URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlSafetyError(`[${label}] Unsupported protocol: ${url.protocol}`);
  }

  if (url.username || url.password) {
    throw new UrlSafetyError(`[${label}] URL must not include username/password`);
  }

  // Reject empty host.
  if (!url.hostname) {
    throw new UrlSafetyError(`[${label}] Missing hostname`);
  }

  // If hostname is an IP literal, validate it directly.
  if (isIP(url.hostname)) {
    const verdict = isPublicIpAddress(url.hostname);
    if (!verdict.ok) throw new UrlSafetyError(`[${label}] ${verdict.reason}`);
    return;
  }

  await assertSafeHostname(url.hostname, label);
}
