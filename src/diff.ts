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

export function approxChangeRatio(oldText: string, newText: string): number {
  if (oldText === newText) return 0;
  const oldLen = oldText.length;
  const newLen = newText.length;
  const denom = oldLen + newLen;
  if (denom === 0) return 0;

  let prefix = 0;
  while (prefix < oldLen && prefix < newLen && oldText[prefix] === newText[prefix]) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < oldLen - prefix &&
    suffix < newLen - prefix &&
    oldText[oldLen - 1 - suffix] === newText[newLen - 1 - suffix]
  ) {
    suffix += 1;
  }

  const changedOld = oldLen - prefix - suffix;
  const changedNew = newLen - prefix - suffix;
  return (changedOld + changedNew) / denom;
}
