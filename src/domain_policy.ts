export class DomainPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainPolicyError';
  }
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/\.$/, '').toLowerCase();
}

function normalizePattern(pattern: string): string {
  const trimmed = pattern.trim().toLowerCase();
  if (trimmed.startsWith('*.')) return `*.${trimmed.slice(2).replace(/\.$/, '')}`;
  if (trimmed.startsWith('.')) return `.${trimmed.slice(1).replace(/\.$/, '')}`;
  return trimmed.replace(/\.$/, '');
}

function matchesPattern(pattern: string, hostname: string): boolean {
  const host = normalizeHostname(hostname);
  const pat = normalizePattern(pattern);

  if (!pat) return false;

  if (pat.startsWith('*.')) {
    const suffix = pat.slice(2);
    if (!suffix) return false;
    return host !== suffix && host.endsWith(`.${suffix}`);
  }

  if (pat.startsWith('.')) {
    const suffix = pat.slice(1);
    if (!suffix) return false;
    return host !== suffix && host.endsWith(`.${suffix}`);
  }

  return host === pat;
}

function matchesAny(patterns: string[], hostname: string): string | null {
  for (const p of patterns) {
    if (matchesPattern(p, hostname)) return p;
  }
  return null;
}

export function assertUrlAllowedByDomainPolicy(
  rawUrl: string,
  label: string,
  opts: { allowlist: string[]; denylist: string[] },
): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new DomainPolicyError(`[${label}] Invalid URL`);
  }

  const host = url.hostname;
  if (!host) throw new DomainPolicyError(`[${label}] Missing hostname`);

  const deniedBy = matchesAny(opts.denylist, host);
  if (deniedBy) throw new DomainPolicyError(`[${label}] Blocked by denylist rule: ${deniedBy}`);

  if (opts.allowlist.length > 0) {
    const allowedBy = matchesAny(opts.allowlist, host);
    if (!allowedBy) {
      throw new DomainPolicyError(`[${label}] Hostname not in allowlist: ${normalizeHostname(host)}`);
    }
  }
}

