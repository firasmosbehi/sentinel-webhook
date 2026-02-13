import crypto from 'node:crypto';
import express from 'express';

const app = express();

// Use raw body to verify signatures.
app.post('/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const rawBody = req.body instanceof Buffer ? req.body : Buffer.from(req.body ?? '');
  const rawText = rawBody.toString('utf8');

  const eventId = req.header('x-sentinel-event-id') ?? '';
  const timestamp = req.header('x-sentinel-timestamp') ?? '';
  const signature = req.header('x-sentinel-signature') ?? '';

  const secret = process.env.SENTINEL_WEBHOOK_SECRET;
  if (secret) {
    const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawText}`).digest('hex');
    const expected = `sha256=${mac}`;
    const ok =
      signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature, 'utf8'), Buffer.from(expected, 'utf8'));
    if (!ok) {
      res.status(401).json({ ok: false, error: 'invalid_signature' });
      return;
    }
  }

  let payload = null;
  try {
    payload = JSON.parse(rawText);
  } catch {
    // Ignore parse errors; keep raw.
  }

  console.log('sentinel webhook received', { eventId, event: payload?.event, url: payload?.url });
  res.json({ ok: true, eventId });
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`listening on http://127.0.0.1:${port}/webhook`);
});

