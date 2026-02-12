import type { Snapshot } from './types.js';

function extractFirstNumber(text: string): number | null {
  const m = text.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

export function computeTextChange(previous: Snapshot, current: Snapshot): {
  old: string;
  new: string;
  delta?: number;
} | null {
  if (previous.contentHash === current.contentHash) return null;

  const out: { old: string; new: string; delta?: number } = { old: previous.text, new: current.text };

  // Heuristic: only compute delta for short text fragments.
  if (previous.text.length <= 64 && current.text.length <= 64) {
    const prevNum = extractFirstNumber(previous.text);
    const currNum = extractFirstNumber(current.text);
    if (prevNum !== null && currNum !== null) {
      out.delta = currNum - prevNum;
    }
  }

  return out;
}
