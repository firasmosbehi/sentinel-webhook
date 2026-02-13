import { createTwoFilesPatch } from 'diff';
import { truncate } from './redact.js';

export function makeUnifiedTextPatch(
  oldText: string,
  newText: string,
  opts: { contextLines: number; maxChars: number },
): { patch: string; truncated: boolean } {
  const context = Math.max(0, Math.floor(opts.contextLines));
  const raw = createTwoFilesPatch('previous', 'current', oldText, newText, '', '', { context });
  const t = truncate(raw, Math.max(0, Math.floor(opts.maxChars)));
  return { patch: t.text, truncated: t.truncated };
}

