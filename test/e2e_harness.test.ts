import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

function listen(server: ReturnType<typeof createServer>): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('Failed to bind server'));
      resolve({ port: addr.port });
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function runActorOnce(input: unknown, localStorageDir: string): Promise<void> {
  const tsxBin = resolve('node_modules/.bin/tsx');
  const mainFile = resolve('src/main.ts');

  await new Promise<void>((resolveRun, rejectRun) => {
    const child = spawn(tsxBin, [mainFile], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        SENTINEL_INPUT: JSON.stringify(input),
        APIFY_LOCAL_STORAGE_DIR: localStorageDir,
        // Keep logs quiet in CI; failures still surface via exit code.
        LOG_LEVEL: 'ERROR',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stdout.on('data', () => undefined);
    child.stderr.on('data', (c) => (stderr += c.toString('utf8')));

    child.on('error', (err) => rejectRun(err));
    child.on('exit', (code) => {
      if (code === 0) return resolveRun();
      rejectRun(new Error(`Actor run failed with code ${code}. stderr: ${stderr.slice(0, 2000)}`));
    });
  });
}

describe('e2e harness (baseline -> no-change -> change)', () => {
  let localStorageDir = '';
  let pageText = '<html><body><div id="x">hello</div></body></html>';
  const received: unknown[] = [];

  const target = createServer((_req: IncomingMessage, res: ServerResponse) => {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(pageText);
  });

  const webhook = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.from(c)));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        received.push(JSON.parse(body));
      } catch {
        received.push(body);
      }
      res.statusCode = 200;
      res.end('ok');
    });
  });

  let targetUrl = '';
  let webhookUrl = '';

  beforeAll(async () => {
    localStorageDir = await mkdtemp(join(tmpdir(), 'sentinel-e2e-'));
    const t = await listen(target);
    const w = await listen(webhook);
    targetUrl = `http://127.0.0.1:${t.port}/page`;
    webhookUrl = `http://127.0.0.1:${w.port}/hook`;
  });

  afterAll(async () => {
    await close(target);
    await close(webhook);
    if (localStorageDir) {
      await rm(localStorageDir, { recursive: true, force: true });
    }
  });

  it('runs 3 times and only sends webhook on change', async () => {
    const baseInput = {
      mode: 'monitor',
      target_url: targetUrl,
      webhook_url: webhookUrl,
      allow_localhost: true,
      baseline_mode: 'store_only',
      history_mode: 'none',
      fetch_max_retries: 0,
      webhook_max_retries: 0,
      fetch_timeout_secs: 5,
      webhook_timeout_secs: 5,
    };

    received.length = 0;

    // 1) baseline stored, no webhook
    await runActorOnce(baseInput, localStorageDir);
    expect(received.length).toBe(0);

    // 2) no change, no webhook
    await runActorOnce(baseInput, localStorageDir);
    expect(received.length).toBe(0);

    // 3) change detected, webhook delivered once
    pageText = '<html><body><div id="x">hello world</div></body></html>';
    await runActorOnce(baseInput, localStorageDir);
    expect(received.length).toBe(1);

    const payload = received[0] as Record<string, unknown>;
    expect(payload.event).toBe('CHANGE_DETECTED');
    expect(typeof payload.event_id).toBe('string');
    expect(typeof payload.timestamp).toBe('string');
  });
});
