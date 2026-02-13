import { describe, expect, it } from 'vitest';
import { extractFieldsFromHtml, FieldExtractionError } from '../src/fields_extract.js';
import type { FieldSpec } from '../src/types.js';

describe('extractFieldsFromHtml', () => {
  it('extracts text and attribute fields', () => {
    const html = `
      <html>
        <body>
          <div class="price"> $49.99 </div>
          <div class="stock" data-stock="In Stock">In Stock</div>
        </body>
      </html>
    `;

    const fields: FieldSpec[] = [
      { name: 'price', selector: '.price', type: 'text' },
      { name: 'stock', selector: '.stock', type: 'attribute', attribute: 'data-stock' },
    ];

    const out = extractFieldsFromHtml(html, fields, {
      ignoreSelectors: [],
      ignoreAttributes: [],
      ignoreRegexes: [],
    });

    expect(out).toEqual({ price: '$49.99', stock: 'In Stock' });
  });

  it('throws FieldExtractionError when selector matches nothing', () => {
    const html = `<div class="price">$49.99</div>`;
    const fields: FieldSpec[] = [{ name: 'price', selector: '.missing', type: 'text' }];

    expect(() =>
      extractFieldsFromHtml(html, fields, { ignoreSelectors: [], ignoreAttributes: [], ignoreRegexes: [] }),
    ).toThrow(FieldExtractionError);
  });

  it('applies ignore regexes to extracted values', () => {
    const html = `<div class="price">$49.99</div>`;
    const fields: FieldSpec[] = [{ name: 'price', selector: '.price', type: 'text' }];

    const out = extractFieldsFromHtml(html, fields, { ignoreSelectors: [], ignoreAttributes: [], ignoreRegexes: ['\\$'] });
    expect(out).toEqual({ price: '49.99' });
  });
});

