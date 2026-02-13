# Signature Verification

When `webhook_secret` is set, Sentinel sends:
- `x-sentinel-timestamp`: Unix seconds (string)
- `x-sentinel-signature`: `sha256=<hex>`

Signature input:
- `HMAC_SHA256(secret, \"${timestamp}.${rawBody}\")`

Important:
- Verify using the raw request body bytes (not a re-serialized JSON object).
- Enforce a timestamp tolerance window (e.g. 5 minutes) to reduce replay risk.

## Node.js (Express)

```js
import crypto from 'node:crypto';

function verifySignature({ secret, timestamp, signature, rawBody }) {
  const mac = crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const expected = `sha256=${mac}`;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

Use `express.raw({ type: 'application/json' })` to access `rawBody`.

## Python

```python
import hmac
import hashlib

def verify_signature(secret: str, timestamp: str, signature: str, raw_body: bytes) -> bool:
    mac = hmac.new(secret.encode("utf-8"), msg=(timestamp.encode("utf-8") + b"." + raw_body), digestmod=hashlib.sha256).hexdigest()
    expected = f"sha256={mac}"
    return hmac.compare_digest(signature, expected)
```

