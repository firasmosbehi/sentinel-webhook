function decodePointerSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

function splitJsonPointer(pointer: string): string[] | null {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) return null;
  // Leading '/' means first segment is after it.
  const raw = pointer.split('/').slice(1);
  return raw.map(decodePointerSegment);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function removeJsonPointerPaths(root: unknown, ignorePointers: string[]): unknown {
  // Work on a clone to avoid surprising callers.
  const cloned = structuredClone(root);

  for (const p of ignorePointers) {
    const segments = splitJsonPointer(p);
    if (!segments) continue;

    // Ignore root: removing the entire document results in null.
    if (segments.length === 0) return null;

    let parent: unknown = cloned;
    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;
      if (Array.isArray(parent)) {
        const idx = Number(seg);
        if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) {
          parent = null;
          break;
        }
        parent = parent[idx];
      } else if (isObject(parent)) {
        if (!(seg in parent)) {
          parent = null;
          break;
        }
        parent = parent[seg];
      } else {
        parent = null;
        break;
      }
    }

    if (!parent) continue;
    const last = segments[segments.length - 1]!;
    if (Array.isArray(parent)) {
      const idx = Number(last);
      if (!Number.isInteger(idx) || idx < 0 || idx >= parent.length) continue;
      // Remove array element (stable and deterministic).
      parent.splice(idx, 1);
      continue;
    }
    if (isObject(parent)) {
      delete parent[last];
    }
  }

  return cloned;
}

