export type JsonDiffEntry = {
  path: string;
  op: 'add' | 'remove' | 'replace';
  old?: unknown;
  new?: unknown;
};

const MISSING = Symbol('missing');
type MaybeValue = unknown | typeof MISSING;

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function escapePointerSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

function joinPath(base: string, seg: string): string {
  const encoded = escapePointerSegment(seg);
  return base === '' ? `/${encoded}` : `${base}/${encoded}`;
}

function shouldIgnore(path: string, ignore: string[]): boolean {
  for (const p of ignore) {
    if (!p) continue;
    if (path === p) return true;
    if (p !== '/' && path.startsWith(`${p}/`)) return true;
  }
  return false;
}

function diffInner(prev: MaybeValue, curr: MaybeValue, path: string, ignore: string[], out: JsonDiffEntry[]): void {
  if (shouldIgnore(path, ignore)) return;

  if (prev === MISSING && curr === MISSING) return;
  if (prev === MISSING) {
    out.push({ path, op: 'add', new: curr });
    return;
  }
  if (curr === MISSING) {
    out.push({ path, op: 'remove', old: prev });
    return;
  }

  if (Array.isArray(prev) && Array.isArray(curr)) {
    const maxLen = Math.max(prev.length, curr.length);
    for (let i = 0; i < maxLen; i++) {
      const pVal: MaybeValue = i < prev.length ? prev[i] : MISSING;
      const cVal: MaybeValue = i < curr.length ? curr[i] : MISSING;
      diffInner(pVal, cVal, joinPath(path, String(i)), ignore, out);
    }
    return;
  }

  if (isObject(prev) && isObject(curr)) {
    const keys = new Set([...Object.keys(prev), ...Object.keys(curr)]);
    const sorted = [...keys].sort();
    for (const k of sorted) {
      const pVal: MaybeValue = k in prev ? prev[k] : MISSING;
      const cVal: MaybeValue = k in curr ? curr[k] : MISSING;
      diffInner(pVal, cVal, joinPath(path, k), ignore, out);
    }
    return;
  }

  // Primitives or type mismatch.
  if (prev !== curr) {
    out.push({ path, op: 'replace', old: prev, new: curr });
  }
}

export function diffJson(previous: unknown, current: unknown, ignoreJsonPointers: string[] = []): JsonDiffEntry[] {
  const out: JsonDiffEntry[] = [];
  diffInner(previous, current, '', ignoreJsonPointers, out);

  // Stable ordering.
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}
