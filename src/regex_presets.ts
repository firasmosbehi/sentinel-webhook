import type { IgnoreRegexPreset } from './types.js';

const PRESETS: Record<IgnoreRegexPreset, string[]> = {
  timestamps: [
    // ISO 8601 timestamps, e.g. 2026-02-13T12:34:56Z or with milliseconds/offset.
    '\\\\b\\\\d{4}-\\\\d{2}-\\\\d{2}T\\\\d{2}:\\\\d{2}:\\\\d{2}(?:\\\\.\\\\d+)?(?:Z|[+-]\\\\d{2}:\\\\d{2})\\\\b',
    // Common date formats, e.g. 2026-02-13 or 02/13/2026.
    '\\\\b\\\\d{4}-\\\\d{2}-\\\\d{2}\\\\b',
    '\\\\b\\\\d{1,2}\\\\/\\\\d{1,2}\\\\/\\\\d{2,4}\\\\b',
  ],
  uuids: [
    '\\\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}\\\\b',
  ],
  tokens: [
    // JWT-like tokens (3 base64url-ish segments).
    '\\\\b[A-Za-z0-9_-]{10,}\\\\.[A-Za-z0-9_-]{10,}\\\\.[A-Za-z0-9_-]{10,}\\\\b',
    // Long hex strings (hashes, tokens).
    '\\\\b[0-9a-fA-F]{32,}\\\\b',
  ],
};

export function expandIgnoreRegexPresets(presets: IgnoreRegexPreset[]): string[] {
  const out: string[] = [];
  for (const p of presets) {
    const patterns = PRESETS[p];
    if (patterns) out.push(...patterns);
  }
  return out;
}
