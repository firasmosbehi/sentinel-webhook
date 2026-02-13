import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const ICON_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sentinel Icon</title>
    <style>
      :root {
        --bg1: #0b1020;
        --bg2: #0d2b3f;
        --accent: #44ffcc;
        --accent2: #7aa7ff;
      }
      html,
      body {
        height: 100%;
        margin: 0;
      }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #050713;
      }
      #icon {
        width: 512px;
        height: 512px;
        border-radius: 96px;
        position: relative;
        overflow: hidden;
        background:
          radial-gradient(circle at 28% 28%, rgba(122, 167, 255, 0.22), transparent 55%),
          radial-gradient(circle at 72% 72%, rgba(68, 255, 204, 0.16), transparent 58%),
          linear-gradient(145deg, var(--bg1), var(--bg2));
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55);
      }
      .sweep {
        position: absolute;
        inset: 0;
        transform: rotate(315deg);
        background: conic-gradient(
          from 90deg,
          rgba(68, 255, 204, 0) 0deg,
          rgba(68, 255, 204, 0) 300deg,
          rgba(68, 255, 204, 0.22) 340deg,
          rgba(68, 255, 204, 0) 360deg
        );
        mix-blend-mode: screen;
      }
      .ring {
        position: absolute;
        inset: 88px;
        border-radius: 999px;
        border: 3px solid rgba(68, 255, 204, 0.14);
      }
      .ring.r2 {
        inset: 128px;
        border-color: rgba(122, 167, 255, 0.12);
      }
      .ring.r3 {
        inset: 168px;
        border-color: rgba(255, 255, 255, 0.06);
      }
      .dot {
        position: absolute;
        left: 56%;
        top: 34%;
        width: 18px;
        height: 18px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 10px rgba(68, 255, 204, 0.12), 0 0 30px rgba(68, 255, 204, 0.55);
      }
      .mark {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: ui-serif, Georgia, "Times New Roman", serif;
        font-weight: 800;
        font-size: 240px;
        letter-spacing: -10px;
        color: rgba(255, 255, 255, 0.92);
        text-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
      }
      .mark span {
        transform: translateY(-8px);
      }
    </style>
  </head>
  <body>
    <div id="icon" role="img" aria-label="Sentinel">
      <div class="sweep"></div>
      <div class="ring r1"></div>
      <div class="ring r2"></div>
      <div class="ring r3"></div>
      <div class="dot"></div>
      <div class="mark"><span>S</span></div>
    </div>
  </body>
</html>`;

function storeScreenshotHtml(opts: { title: string; subtitle: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${opts.title}</title>
    <style>
      :root {
        --bg: #0b1020;
        --bg2: #0d2b3f;
        --card: rgba(255, 255, 255, 0.06);
        --card2: rgba(255, 255, 255, 0.08);
        --text: rgba(255, 255, 255, 0.92);
        --muted: rgba(255, 255, 255, 0.66);
        --accent: #44ffcc;
        --accent2: #7aa7ff;
        --shadow: rgba(0, 0, 0, 0.55);
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        height: 100%;
        margin: 0;
      }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji",
          "Segoe UI Emoji";
        color: var(--text);
        background:
          radial-gradient(1100px 600px at 20% 25%, rgba(122, 167, 255, 0.18), transparent 60%),
          radial-gradient(900px 500px at 75% 70%, rgba(68, 255, 204, 0.14), transparent 55%),
          linear-gradient(140deg, var(--bg), var(--bg2));
      }
      .wrap {
        width: 1280px;
        height: 720px;
        padding: 48px;
        display: flex;
        flex-direction: column;
        gap: 28px;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .brand {
        display: flex;
        align-items: center;
        gap: 14px;
      }
      .badge {
        width: 42px;
        height: 42px;
        border-radius: 14px;
        background: linear-gradient(145deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.04));
        border: 1px solid rgba(255, 255, 255, 0.12);
        display: grid;
        place-items: center;
        color: var(--accent);
        font-weight: 800;
        box-shadow: 0 18px 40px var(--shadow);
      }
      h1 {
        margin: 0;
        font-size: 44px;
        letter-spacing: -0.02em;
      }
      .subtitle {
        margin-top: 6px;
        color: var(--muted);
        font-size: 18px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.25);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.8);
        font-size: 14px;
      }
      .pill b {
        color: rgba(255, 255, 255, 0.92);
        font-weight: 700;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.15fr 0.85fr;
        gap: 18px;
        flex: 1;
        min-height: 0;
      }
      .card {
        background: var(--card);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 22px;
        box-shadow: 0 24px 70px var(--shadow);
        overflow: hidden;
      }
      .card .hd {
        padding: 16px 18px;
        background: linear-gradient(180deg, var(--card2), rgba(255, 255, 255, 0));
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .card .hd .t {
        font-weight: 700;
      }
      .card .bd {
        padding: 18px;
        height: calc(100% - 54px);
        overflow: hidden;
      }
      .flow {
        display: grid;
        grid-template-columns: 1fr auto 1fr auto 1fr;
        align-items: center;
        gap: 12px;
        padding: 16px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.22);
      }
      .node {
        padding: 14px 14px;
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
      }
      .node .k {
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.6);
      }
      .node .v {
        margin-top: 6px;
        font-weight: 800;
        font-size: 18px;
      }
      .arrow {
        color: rgba(255, 255, 255, 0.45);
        font-size: 20px;
      }
      pre {
        margin: 0;
        height: 100%;
        padding: 14px 14px;
        border-radius: 18px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.28);
        border: 1px solid rgba(255, 255, 255, 0.12);
        color: rgba(255, 255, 255, 0.86);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre;
      }
      .callouts {
        display: grid;
        gap: 10px;
      }
      .callout {
        padding: 14px 14px;
        border-radius: 18px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.22);
      }
      .callout b {
        color: rgba(255, 255, 255, 0.92);
      }
      .callout .m {
        margin-top: 6px;
        color: rgba(255, 255, 255, 0.72);
        font-size: 14px;
        line-height: 1.45;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        <div>
          <div class="brand">
            <div class="badge">S</div>
            <div>
              <h1>${opts.title}</h1>
              <div class="subtitle">${opts.subtitle}</div>
            </div>
          </div>
        </div>
        <div class="pill"><b>Developer-first</b> URL monitoring</div>
      </div>
      ${opts.body}
    </div>
  </body>
</html>`;
}

const STORE_1_HTML = storeScreenshotHtml({
  title: 'Sentinel Webhook',
  subtitle: 'Turn any URL into a clean JSON webhook with only what changed.',
  body: `
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="t">How it works</div>
          <div class="pill"><b>Event-driven</b> from static pages</div>
        </div>
        <div class="bd" style="display:flex; flex-direction:column; gap:14px;">
          <div class="flow">
            <div class="node">
              <div class="k">Input</div>
              <div class="v">URL + selector</div>
            </div>
            <div class="arrow">→</div>
            <div class="node">
              <div class="k">Sentinel</div>
              <div class="v">Poll + diff + noise filters</div>
            </div>
            <div class="arrow">→</div>
            <div class="node">
              <div class="k">Output</div>
              <div class="v">Webhook (JSON)</div>
            </div>
          </div>
          <pre>{
  "event": "CHANGE_DETECTED",
  "url": "https://example.com/product/xyz",
  "timestamp": "2026-05-12T10:00:00Z",
  "summary": "Fields changed: price: 49.99 -> 45.00 (delta -4.99)",
  "changes": {
    "fields": {
      "price": { "old": "49.99", "new": "45.00", "delta": -4.99 }
    }
  }
}</pre>
        </div>
      </div>
      <div class="card">
        <div class="hd">
          <div class="t">Built for real pages</div>
          <div class="pill"><b>Safe</b> by default</div>
        </div>
        <div class="bd">
          <div class="callouts">
            <div class="callout">
              <b>Stateful monitoring</b>
              <div class="m">Baseline snapshots are stored between runs for precise diffs.</div>
            </div>
            <div class="callout">
              <b>Noise reduction</b>
              <div class="m">Ignore selectors, attributes, regexes. Unicode + whitespace normalization.</div>
            </div>
            <div class="callout">
              <b>Delivery semantics</b>
              <div class="m">Retries, dead-letter, replay, and circuit breaker for unstable endpoints.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
});

const STORE_2_HTML = storeScreenshotHtml({
  title: 'Snapshot Mode',
  subtitle: 'Optional before/after screenshots stored as artifacts and referenced in the webhook payload.',
  body: `
    <div class="grid">
      <div class="card">
        <div class="hd">
          <div class="t">Webhook payload</div>
          <div class="pill"><b>Artifacts</b> included</div>
        </div>
        <div class="bd">
          <pre>{
  "event": "CHANGE_DETECTED",
  "event_id": "evt_...",
  "url": "https://example.com/product/xyz",
  "timestamp": "2026-05-12T10:00:00Z",
  "changes": { "text": { "old": "In Stock", "new": "Low Inventory" } },
  "artifacts": {
    "screenshots": {
      "scope": "selector",
      "selector": ".price",
      "before": { "store_name": "SENTINEL_ARTIFACTS", "key": "artifact-...-before.png", "content_type": "image/png", "bytes": 12345 },
      "after":  { "store_name": "SENTINEL_ARTIFACTS", "key": "artifact-...-after.png",  "content_type": "image/png", "bytes": 12580 }
    }
  }
}</pre>
        </div>
      </div>
      <div class="card">
        <div class="hd">
          <div class="t">Inputs</div>
          <div class="pill"><b>Playwright</b> rendering</div>
        </div>
        <div class="bd">
          <div class="callouts">
            <div class="callout">
              <b>rendering_mode</b>
              <div class="m">Use Playwright for JS-heavy pages and screenshot capture.</div>
            </div>
            <div class="callout">
              <b>screenshot_scope</b>
              <div class="m">Capture full page or a specific selector region.</div>
            </div>
            <div class="callout">
              <b>artifact_store_name</b>
              <div class="m">Store artifacts in a dedicated Key-Value Store for audit/debug.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
});

const DEMO_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sentinel Demo</title>
    <style>
      :root {
        --bg: #0b1020;
        --bg2: #0d2b3f;
        --text: rgba(255, 255, 255, 0.92);
        --muted: rgba(255, 255, 255, 0.66);
        --accent: #44ffcc;
        --accent2: #7aa7ff;
        --shadow: rgba(0, 0, 0, 0.55);
      }
      * {
        box-sizing: border-box;
      }
      html,
      body {
        height: 100%;
        margin: 0;
      }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
        color: var(--text);
        background:
          radial-gradient(1100px 600px at 20% 25%, rgba(122, 167, 255, 0.18), transparent 60%),
          radial-gradient(900px 500px at 75% 70%, rgba(68, 255, 204, 0.14), transparent 55%),
          linear-gradient(140deg, var(--bg), var(--bg2));
      }
      .wrap {
        height: 100%;
        padding: 46px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 18px;
      }
      .card {
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 22px;
        box-shadow: 0 24px 70px var(--shadow);
        overflow: hidden;
        display: flex;
        flex-direction: column;
      }
      .hd {
        padding: 16px 18px;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0));
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .title {
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .step {
        padding: 18px;
        font-size: 28px;
        font-weight: 800;
        letter-spacing: -0.02em;
      }
      .hint {
        margin-top: 8px;
        color: var(--muted);
        font-size: 14px;
        font-weight: 500;
      }
      .pulse {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: var(--accent);
        box-shadow: 0 0 0 0 rgba(68, 255, 204, 0.35);
        animation: pulse 1.2s ease-out infinite;
      }
      @keyframes pulse {
        0% {
          box-shadow: 0 0 0 0 rgba(68, 255, 204, 0.35);
        }
        100% {
          box-shadow: 0 0 0 18px rgba(68, 255, 204, 0);
        }
      }
      pre {
        margin: 0;
        flex: 1;
        padding: 16px 16px;
        background: rgba(0, 0, 0, 0.28);
        border-top: 1px solid rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.86);
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 13px;
        line-height: 1.45;
        white-space: pre;
      }
      .tag {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        padding: 8px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(0, 0, 0, 0.22);
        color: rgba(255, 255, 255, 0.8);
        font-size: 13px;
        font-weight: 600;
      }
      .tag b {
        color: rgba(255, 255, 255, 0.92);
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="hd">
          <div class="title">Sentinel Webhook</div>
          <div class="tag"><span class="pulse"></span><b>Live</b> demo</div>
        </div>
        <div class="step" id="step"></div>
        <div class="hint" id="hint" style="padding: 0 18px 18px 18px;"></div>
      </div>
      <div class="card">
        <div class="hd">
          <div class="title">Payload</div>
          <div class="tag"><b>URL</b> → webhook</div>
        </div>
        <pre id="code"></pre>
      </div>
    </div>
    <script>
      const steps = [
        {
          step: "1) Monitor a URL",
          hint: "Configure a target_url and a webhook_url (Zapier/Make/custom API).",
          code:
            '{\\n' +
            '  "target_url": "https://example.com/product/xyz",\\n' +
            '  "selector": ".price",\\n' +
            '  "webhook_url": "https://hooks.example.com/...",\\n' +
            '  "rendering_mode": "playwright"\\n' +
            '}\\n',
        },
        {
          step: "2) Poll + diff",
          hint: "Sentinel stores a baseline snapshot and only emits events when something changes.",
          code:
            '{\\n' +
            '  "event": "NO_CHANGE",\\n' +
            '  "timestamp": "2026-05-12T10:15:00Z",\\n' +
            '  "url": "https://example.com/product/xyz"\\n' +
            '}\\n',
        },
        {
          step: "3) Change detected",
          hint: "A clean JSON payload contains only the diff. Optional unified patch and screenshots.",
          code:
            '{\\n' +
            '  "event": "CHANGE_DETECTED",\\n' +
            '  "timestamp": "2026-05-12T10:30:00Z",\\n' +
            '  "changes": { "text": { "old": "$49.99", "new": "$45.00", "delta": -4.99 } },\\n' +
            '  "artifacts": { "screenshots": { "before": { "key": "artifact-...-before.png" }, "after": { "key": "artifact-...-after.png" } } }\\n' +
            '}\\n',
        },
        {
          step: "4) Trigger automation",
          hint: "Your webhook endpoint returns 2xx, and the rest of your stack reacts.",
          code:
            "POST /hook\\n" +
            "→ 200 OK\\n\\n" +
            "Next: send Slack alert, update DB, create ticket, buy/sell, etc.\\n",
        },
      ];

      const stepEl = document.getElementById("step");
      const hintEl = document.getElementById("hint");
      const codeEl = document.getElementById("code");

      let i = 0;
      function render() {
        const s = steps[i];
        stepEl.textContent = s.step;
        hintEl.textContent = s.hint;
        codeEl.textContent = s.code;
      }

      render();
      setInterval(() => {
        i = (i + 1) % steps.length;
        render();
      }, 2200);
    </script>
  </body>
</html>`;

async function main(): Promise<void> {
  const { chromium } = await import('playwright');

  const assetsDir = resolve('assets');
  const storeDir = resolve('assets/store');
  await mkdir(storeDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    // Icon (512x512)
    {
      const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
      await page.setContent(ICON_HTML, { waitUntil: 'load' });
      await page.locator('#icon').screenshot({ path: resolve(assetsDir, 'icon.png') });
      await page.close();
    }

    // Store screenshots (1280x720)
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.setContent(STORE_1_HTML, { waitUntil: 'load' });
      await page.screenshot({ path: resolve(storeDir, 'screenshot-1.png') });
      await page.close();
    }
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
      await page.setContent(STORE_2_HTML, { waitUntil: 'load' });
      await page.screenshot({ path: resolve(storeDir, 'screenshot-2.png') });
      await page.close();
    }

    // Demo video (recorded .webm)
    {
      const tmpVideoDir = resolve(assetsDir, '.tmp-video');
      await rm(tmpVideoDir, { recursive: true, force: true });
      await mkdir(tmpVideoDir, { recursive: true });

      const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        recordVideo: { dir: tmpVideoDir, size: { width: 1280, height: 720 } },
      });
      const page = await context.newPage();
      await page.setContent(DEMO_HTML, { waitUntil: 'load' });
      await page.waitForTimeout(9_000);
      await context.close();

      const files = await readdir(tmpVideoDir);
      const webm = files.find((f) => f.endsWith('.webm'));
      if (!webm) throw new Error('Playwright did not produce a .webm file.');
      await rename(join(tmpVideoDir, webm), resolve(assetsDir, 'demo.webm'));
      await rm(tmpVideoDir, { recursive: true, force: true });
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

