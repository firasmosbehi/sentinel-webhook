function stabilize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stabilize);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = stabilize(obj[k]);
    }
    return out;
  }
  return value;
}

export function stableStringifyJson(value: unknown): string {
  return JSON.stringify(stabilize(value));
}

