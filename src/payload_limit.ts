import { truncate } from './redact.js';
import type { ChangePayload } from './types.js';

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function allocateChars(total: number, oldLen: number, newLen: number): { oldChars: number; newChars: number } {
  if (total <= 0) return { oldChars: 0, newChars: 0 };
  if (oldLen <= 0) return { oldChars: 0, newChars: Math.min(newLen, total) };
  if (newLen <= 0) return { oldChars: Math.min(oldLen, total), newChars: 0 };

  const denom = oldLen + newLen;
  let oldChars = Math.floor((total * oldLen) / denom);
  let newChars = total - oldChars;

  // Cap to available lengths and re-allocate leftover to the other side.
  if (oldChars > oldLen) {
    oldChars = oldLen;
    newChars = Math.min(newLen, total - oldChars);
  }
  if (newChars > newLen) {
    newChars = newLen;
    oldChars = Math.min(oldLen, total - newChars);
  }

  // If rounding left some slack, assign it to whichever side still has room.
  let remaining = total - oldChars - newChars;
  while (remaining > 0 && (oldChars < oldLen || newChars < newLen)) {
    if (oldChars < oldLen) {
      oldChars += 1;
      remaining -= 1;
      if (remaining <= 0) break;
    }
    if (newChars < newLen) {
      newChars += 1;
      remaining -= 1;
    }
  }

  return { oldChars, newChars };
}

function buildTruncatedPayload(payload: ChangePayload, oldChars: number, newChars: number): ChangePayload {
  const textChange = payload.changes?.text;
  if (!textChange) return payload;

  const oldT = truncate(textChange.old, oldChars);
  const newT = truncate(textChange.new, newChars);

  return {
    ...payload,
    payload_truncated: true,
    changes: {
      text: {
        ...textChange,
        old: oldT.text,
        new: newT.text,
      },
    },
  };
}

export function limitPayloadBytes(
  payload: ChangePayload,
  maxBytes: number,
): { payload: ChangePayload; truncated: boolean } {
  const initialBytes = jsonByteLength(payload);
  if (initialBytes <= maxBytes) return { payload, truncated: false };

  // Only change payload text is truncatable today.
  if (!payload.changes || !payload.changes.text) {
    throw new Error(`Payload exceeds max_payload_bytes (${initialBytes} > ${maxBytes}) but has no changes to truncate.`);
  }

  const oldLen = payload.changes.text.old.length;
  const newLen = payload.changes.text.new.length;

  const minimal = buildTruncatedPayload(payload, 0, 0);
  const minimalBytes = jsonByteLength(minimal);
  if (minimalBytes > maxBytes) {
    throw new Error(
      `max_payload_bytes too small to fit payload skeleton (${minimalBytes} > ${maxBytes}). Increase max_payload_bytes.`,
    );
  }

  const totalLen = oldLen + newLen;
  let lo = 0;
  let hi = totalLen;
  let best: ChangePayload = minimal;

  // Find the largest total text budget that fits.
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { oldChars, newChars } = allocateChars(mid, oldLen, newLen);
    const candidate = buildTruncatedPayload(payload, oldChars, newChars);
    const bytes = jsonByteLength(candidate);

    if (bytes <= maxBytes) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { payload: best, truncated: true };
}
