import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { parseInput } from '../src/input.js';
import { hmacSha256Hex } from '../src/hash.js';
import type { ChangePayload } from '../src/types.js';

// SSRF protection blocks localhost by default; mock it for local integration testing only.
vi.mock('../src/url_safety.js', () => ({
  assertSafeHttpUrl: vi.fn(async () => undefined),
}));

describe('sendWebhook (integration)', () => {
  it('POSTs JSON with idempotency + signature headers', async () => {
    const received: {
      method: string | undefined;
      url: string | undefined;
      headers: Record<string, string | string[] | undefined>;
      body: string;
    } = { method: undefined, url: undefined, headers: {}, body: '' };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      received.method = req.method;
      received.url = req.url ?? undefined;
      received.headers = req.headers as Record<string, string | string[] | undefined>;

      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        received.body = Buffer.concat(chunks).toString('utf8');
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ ok: true }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Failed to bind test server');
    const webhookUrl = `http://127.0.0.1:${addr.port}/hook`;

    const nowMs = 1_700_000_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(nowMs);

    const input = parseInput({
      target_url: 'https://example.com',
      webhook_url: webhookUrl,
      webhook_secret: 'secret',
      webhook_max_retries: 0,
      webhook_retry_backoff_ms: 0,
      webhook_timeout_secs: 5,
    });

    const payload: ChangePayload = {
      schema_version: 1,
      event_id: 'evt_123',
      event: 'CHANGE_DETECTED',
      url: input.target_url,
      selector: input.selector,
      timestamp: new Date(nowMs).toISOString(),
      changes: { text: { old: 'a', new: 'b' } },
      previous: { contentHash: 'prev', fetchedAt: new Date(nowMs - 1000).toISOString() },
      current: { contentHash: 'curr', fetchedAt: new Date(nowMs).toISOString() },
    };

    const { sendWebhook } = await import('../src/webhook.js');
    await sendWebhook(input, payload);

    const expectedTimestamp = Math.floor(nowMs / 1000).toString();
    const expectedSig = `sha256=${hmacSha256Hex('secret', `${expectedTimestamp}.${JSON.stringify(payload)}`)}`;

    expect(received.method).toBe('POST');
    expect(received.url).toBe('/hook');
    expect(received.body).toBe(JSON.stringify(payload));

    // Node lower-cases incoming header keys.
    expect(received.headers['x-sentinel-event-id']).toBe('evt_123');
    expect(received.headers['idempotency-key']).toBe('evt_123');
    expect(received.headers['x-sentinel-timestamp']).toBe(expectedTimestamp);
    expect(received.headers['x-sentinel-signature']).toBe(expectedSig);

    nowSpy.mockRestore();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });
});

