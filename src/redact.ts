const SENSITIVE_QUERY_KEY_RE =
  /(^|_)(access|api|auth|bearer|code|cookie|key|pass|password|secret|session|signature|sig|token)($|_)/i;

export function redactUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  // Strip credentials and fragments; redact sensitive-looking query parameters.
  url.username = '';
  url.password = '';
  url.hash = '';

  for (const [k, v] of url.searchParams.entries()) {
    if (SENSITIVE_QUERY_KEY_RE.test(k)) {
      url.searchParams.set(k, v ? 'REDACTED' : '');
    }
  }

  return url.toString();
}

export function redactText(raw: string): string {
  // Best-effort redaction for obvious patterns in error messages/logs.
  return raw
    .replace(/(Bearer\\s+)[A-Za-z0-9._-]+/gi, '$1REDACTED')
    .replace(/(token=)[^\\s&]+/gi, '$1REDACTED')
    .replace(/(api[_-]?key=)[^\\s&]+/gi, '$1REDACTED')
    .replace(/(secret=)[^\\s&]+/gi, '$1REDACTED')
    .replace(/(password=)[^\\s&]+/gi, '$1REDACTED');
}

export function truncate(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  if (maxChars <= 3) return { text: '.'.repeat(Math.max(0, maxChars)), truncated: true };
  return { text: `${text.slice(0, maxChars - 3)}...`, truncated: true };
}
