import { Actor, log } from 'apify';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseInput } from './input.js';
import { buildSnapshot } from './snapshot.js';
import { computeTextChange } from './diff.js';
import { makeStateKey } from './state.js';
import { sendWebhook } from './webhook.js';
import type { ChangePayload, Snapshot } from './types.js';

function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  try {
    return new Error(JSON.stringify(err));
  } catch {
    return new Error('Unknown error');
  }
}

async function loadFallbackInput(): Promise<unknown | null> {
  const env = process.env.SENTINEL_INPUT;
  if (env) return JSON.parse(env);

  if (existsSync('INPUT.json')) {
    const raw = await readFile('INPUT.json', 'utf8');
    return JSON.parse(raw);
  }

  return null;
}

await Actor.main(async () => {
  const raw = (await Actor.getInput()) ?? (await loadFallbackInput());
  if (raw == null) {
    throw new Error(
      'Missing input. Provide Apify Actor input or create INPUT.json in the project root or set SENTINEL_INPUT.',
    );
  }
  const input = parseInput(raw);
  log.setLevel(input.debug ? log.LEVELS.DEBUG : log.LEVELS.INFO);

  const kv = await Actor.openKeyValueStore(input.state_store_name);
  const stateKey = makeStateKey(input.target_url, input.selector);

  const previous = (await kv.getValue<Snapshot>(stateKey)) ?? null;

  let current: Snapshot;
  try {
    current = await buildSnapshot(input);
  } catch (err) {
    log.exception(toError(err), 'Failed to fetch/extract snapshot. Keeping previous baseline intact.');
    await Actor.pushData({
      event: 'FETCH_FAILED',
      url: input.target_url,
      selector: input.selector,
      timestamp: new Date().toISOString(),
      stateKey,
    });
    return;
  }

  if (!previous) {
    await kv.setValue(stateKey, current);
    log.info('Baseline stored (no previous snapshot).', { stateKey, contentHash: current.contentHash });

    const payload: ChangePayload = {
      event: 'BASELINE_STORED',
      url: input.target_url,
      selector: input.selector,
      timestamp: new Date().toISOString(),
      current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
    };

    await Actor.pushData({ ...payload, stateKey });

    if (input.baseline_mode === 'notify') {
      await sendWebhook(input, payload);
      log.info('Baseline webhook sent.', { webhook_url: input.webhook_url });
    }

    return;
  }

  const change = computeTextChange(previous, current);
  if (!change) {
    log.info('No change detected.', { stateKey, contentHash: current.contentHash });
    await Actor.pushData({
      event: 'NO_CHANGE',
      url: input.target_url,
      selector: input.selector,
      timestamp: new Date().toISOString(),
      previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
      current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
      stateKey,
    });

    // Refresh baseline metadata (timestamps/headers) even if content is unchanged.
    await kv.setValue(stateKey, current);
    return;
  }

  const payload: ChangePayload = {
    event: 'CHANGE_DETECTED',
    url: input.target_url,
    selector: input.selector,
    timestamp: new Date().toISOString(),
    changes: { text: change },
    previous: { contentHash: previous.contentHash, fetchedAt: previous.fetchedAt },
    current: { contentHash: current.contentHash, fetchedAt: current.fetchedAt },
  };

  await sendWebhook(input, payload);
  log.info('Change detected; webhook delivered.', { webhook_url: input.webhook_url });

  await kv.setValue(stateKey, current);
  await Actor.pushData({ ...payload, stateKey });
});
