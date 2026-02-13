type DomainState = {
  tail: Promise<void>;
  nextAtMs: number;
};

const domainStates = new Map<string, DomainState>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(maxJitterMs: number): number {
  if (maxJitterMs <= 0) return 0;
  return Math.floor(Math.random() * (maxJitterMs + 1));
}

export async function waitForPoliteness(url: string, delayMs: number, maxJitterMs: number = 0): Promise<void> {
  if (delayMs <= 0) return;

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return;
  }

  const state: DomainState = domainStates.get(host) ?? { tail: Promise.resolve(), nextAtMs: 0 };

  const task = state.tail.then(async () => {
    const now = Date.now();
    const waitMs = Math.max(0, state.nextAtMs - now);
    if (waitMs > 0) await sleep(waitMs);
    state.nextAtMs = Date.now() + delayMs + jitterMs(maxJitterMs);
  });

  // Keep the chain alive even if something unexpected throws.
  state.tail = task.catch(() => {});
  domainStates.set(host, state);

  await task;
}

