# Express Webhook Receiver (Example)

This is a minimal webhook receiver for Sentinel:
- Logs received events.
- Optionally verifies `x-sentinel-signature`.

## Run

```bash
cd examples/express-receiver
npm install
export PORT=3000
export SENTINEL_WEBHOOK_SECRET=your-secret   # optional but recommended
npm start
```

## Expose With A Tunnel

Sentinel blocks `localhost` / private IPs for `webhook_url`. Use a public tunnel (e.g. ngrok):

```bash
ngrok http 3000
```

Set Sentinel `webhook_url` to:
- `https://<your-ngrok-domain>/webhook`

