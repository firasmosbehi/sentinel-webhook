export class ResponseTooLargeError extends Error {
  public readonly maxBytes: number;
  public readonly bytesRead: number;

  constructor(message: string, maxBytes: number, bytesRead: number) {
    super(message);
    this.name = 'ResponseTooLargeError';
    this.maxBytes = maxBytes;
    this.bytesRead = bytesRead;
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n < 0) return null;
  return n;
}

export async function readResponseTextWithLimit(
  res: Response,
  maxBytes: number,
): Promise<{ text: string; bytesRead: number }> {
  const contentLength = parseContentLength(res.headers.get('content-length'));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new ResponseTooLargeError(
      `Response too large (Content-Length ${contentLength} > limit ${maxBytes})`,
      maxBytes,
      0,
    );
  }

  if (!res.body) return { text: '', bytesRead: 0 };

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let bytesRead = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytesRead += value.byteLength;
    if (bytesRead > maxBytes) {
      // Best-effort cancel to stop downloads early.
      try {
        await reader.cancel();
      } catch {
        // Ignore.
      }
      throw new ResponseTooLargeError(`Response too large (downloaded > ${maxBytes} bytes)`, maxBytes, bytesRead);
    }

    parts.push(decoder.decode(value, { stream: true }));
  }

  parts.push(decoder.decode());
  return { text: parts.join(''), bytesRead };
}

