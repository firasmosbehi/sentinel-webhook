import type { Dispatcher } from 'undici';

export class RobotsDisallowedError extends Error {
  public readonly url: string;
  public readonly userAgent: string;

  constructor(message: string, opts: { url: string; userAgent: string }) {
    super(message);
    this.name = 'RobotsDisallowedError';
    this.url = opts.url;
    this.userAgent = opts.userAgent;
  }
}

type RobotsRule = {
  allow: boolean;
  pattern: string;
  regex: RegExp;
  length: number;
};

type RobotsGroup = {
  agents: string[]; // lower-cased
  rules: RobotsRule[];
};

type RobotsFile = {
  fetchedAtMs: number;
  groups: RobotsGroup[];
};

type CacheEntry = {
  fetchedAtMs: number;
  file: RobotsFile | null; // null means unavailable/error and we decided to allow
};

const cache = new Map<string, CacheEntry>();

function stripLineComment(line: string): string {
  const idx = line.indexOf('#');
  return (idx >= 0 ? line.slice(0, idx) : line).trim();
}

function compileRobotsPattern(pattern: string): RegExp {
  // robots.txt patterns are path-prefixes with optional wildcards (*) and optional end anchor ($).
  const anchored = pattern.endsWith('$');
  const raw = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = raw.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&').replace(/\\\\\\*/g, '.*');
  const src = anchored ? `^${escaped}$` : `^${escaped}`;
  return new RegExp(src);
}

function parseRobotsTxt(text: string): RobotsGroup[] {
  const lines = text.split(/\\r?\\n/);
  const groups: RobotsGroup[] = [];

  let agents: string[] = [];
  let rules: RobotsRule[] = [];
  let sawDirective = false;

  function pushGroup(): void {
    if (agents.length === 0) return;
    groups.push({ agents, rules });
  }

  for (const rawLine of lines) {
    const line = stripLineComment(rawLine);
    if (!line) continue;

    const idx = line.indexOf(':');
    if (idx < 0) continue;

    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (sawDirective) {
        pushGroup();
        agents = [];
        rules = [];
        sawDirective = false;
      }
      if (value) agents.push(value.toLowerCase());
      continue;
    }

    if (key === 'allow' || key === 'disallow') {
      sawDirective = true;
      if (agents.length === 0) agents = ['*'];

      // Empty disallow means "allow all"; empty allow is effectively a no-op.
      if (!value) {
        if (key === 'disallow') continue;
      }

      const rule: RobotsRule = {
        allow: key === 'allow',
        pattern: value,
        regex: compileRobotsPattern(value),
        length: value.length,
      };
      rules.push(rule);
      continue;
    }
  }

  pushGroup();
  return groups;
}

function pickBestGroup(groups: RobotsGroup[], userAgent: string): RobotsGroup | null {
  const ua = userAgent.toLowerCase();
  let best: RobotsGroup | null = null;
  let bestLen = -1;

  for (const g of groups) {
    let matchLen = -1;
    for (const a of g.agents) {
      if (a === '*') {
        matchLen = Math.max(matchLen, 0);
        continue;
      }
      if (ua.startsWith(a)) matchLen = Math.max(matchLen, a.length);
    }
    if (matchLen > bestLen) {
      best = g;
      bestLen = matchLen;
    }
  }

  return best;
}

function isAllowedByGroup(group: RobotsGroup | null, pathWithQuery: string): boolean {
  if (!group) return true;

  let best: RobotsRule | null = null;
  for (const r of group.rules) {
    if (!r.regex.test(pathWithQuery)) continue;
    if (!best) {
      best = r;
      continue;
    }
    if (r.length > best.length) {
      best = r;
      continue;
    }
    if (r.length === best.length && r.allow && !best.allow) {
      best = r;
    }
  }

  if (!best) return true;
  return best.allow;
}

async function fetchRobotsTxt(
  origin: string,
  userAgent: string,
  opts: { dispatcher?: Dispatcher; timeoutSecs: number },
): Promise<string | null> {
  const robotsUrl = new URL('/robots.txt', origin).toString();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1, opts.timeoutSecs) * 1000);
  try {
    const res = await fetch(robotsUrl, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      dispatcher: opts.dispatcher,
      headers: {
        'user-agent': userAgent,
        accept: 'text/plain,*/*;q=0.9',
      },
    } as unknown as RequestInit);

    if (res.status < 200 || res.status >= 300) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function isRobotsAllowed(
  url: string,
  userAgent: string,
  opts: { dispatcher?: Dispatcher; timeoutSecs: number; cacheTtlMs?: number; allowOnError?: boolean } = { timeoutSecs: 10 },
): Promise<boolean> {
  const u = new URL(url);
  const origin = u.origin;
  const cacheTtlMs = typeof opts.cacheTtlMs === 'number' ? opts.cacheTtlMs : 60 * 60 * 1000;
  const allowOnError = opts.allowOnError ?? true;

  const now = Date.now();
  const cached = cache.get(origin);
  if (cached && now - cached.fetchedAtMs <= cacheTtlMs) {
    if (!cached.file) return allowOnError;
    const group = pickBestGroup(cached.file.groups, userAgent);
    const path = `${u.pathname}${u.search}`;
    return isAllowedByGroup(group, path);
  }

  const body = await fetchRobotsTxt(origin, userAgent, { dispatcher: opts.dispatcher, timeoutSecs: opts.timeoutSecs });
  if (!body) {
    cache.set(origin, { fetchedAtMs: now, file: null });
    return allowOnError;
  }

  const file: RobotsFile = { fetchedAtMs: now, groups: parseRobotsTxt(body) };
  cache.set(origin, { fetchedAtMs: now, file });

  const group = pickBestGroup(file.groups, userAgent);
  const path = `${u.pathname}${u.search}`;
  return isAllowedByGroup(group, path);
}

export async function assertRobotsAllowed(
  url: string,
  userAgent: string,
  opts: { dispatcher?: Dispatcher; timeoutSecs: number; cacheTtlMs?: number; allowOnError?: boolean } = { timeoutSecs: 10 },
): Promise<void> {
  const ok = await isRobotsAllowed(url, userAgent, opts);
  if (!ok) {
    throw new RobotsDisallowedError('Blocked by robots.txt', { url, userAgent });
  }
}

