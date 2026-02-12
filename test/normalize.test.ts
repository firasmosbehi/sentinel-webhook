import { describe, expect, it } from 'vitest';
import { normalizeHtmlToSnapshot } from '../src/normalize.js';

describe('normalizeHtmlToSnapshot', () => {
  it('removes scripts/styles and collapses whitespace', () => {
    const html = `
      <html>
        <head>
          <style>.x{color:red}</style>
          <script>console.log("x")</script>
        </head>
        <body>
          <div> Hello   world </div>
        </body>
      </html>
    `;

    const out = normalizeHtmlToSnapshot(html, { ignoreSelectors: [], ignoreRegexes: [] });
    expect(out.text).toBe('Hello world');
  });

  it('supports selector scoping and ignore selectors', () => {
    const html = `
      <body>
        <div class="price">$49.99</div>
        <div class="ad">BUY NOW</div>
      </body>
    `;

    const out = normalizeHtmlToSnapshot(html, {
      selector: 'body',
      ignoreSelectors: ['.ad'],
      ignoreRegexes: [],
    });
    expect(out.text).toContain('$49.99');
    expect(out.text).not.toContain('BUY NOW');
  });

  it('scrubs ignore regexes', () => {
    const html = `<body>Updated at 2026-01-01T10:00:00Z</body>`;
    const out = normalizeHtmlToSnapshot(html, {
      ignoreSelectors: [],
      ignoreRegexes: ['\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z'],
    });
    expect(out.text).toBe('Updated at');
  });
});

