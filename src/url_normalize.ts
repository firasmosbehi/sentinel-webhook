function stripTrailingDot(hostname: string): string {
  return hostname.replace(/\.$/, '');
}

export function normalizeHttpUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    // parseInput() should already validate, but keep this safe for callers.
    return rawUrl;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return rawUrl;

  url.hash = '';
  url.hostname = stripTrailingDot(url.hostname).toLowerCase();

  // Drop default ports.
  if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
    url.port = '';
  }

  return url.toString();
}

