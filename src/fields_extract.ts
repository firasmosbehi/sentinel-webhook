import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import type { FieldSpec } from './types.js';

export class FieldExtractionError extends Error {
  public readonly fieldName: string;

  constructor(fieldName: string, message: string) {
    super(`[field:${fieldName}] ${message}`);
    this.name = 'FieldExtractionError';
    this.fieldName = fieldName;
  }
}

function compileRegex(pattern: string): RegExp {
  const slashForm = pattern.match(/^\/(.+)\/([a-zA-Z]*)$/);
  if (slashForm) {
    const body = slashForm[1];
    const flagsRaw = slashForm[2] ?? '';
    if (!body) throw new Error(`Invalid regex: ${pattern}`);
    const flags = flagsRaw.includes('g') ? flagsRaw : `${flagsRaw}g`;
    return new RegExp(body, flags);
  }
  return new RegExp(pattern, 'g');
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function extractFieldsFromHtml(
  html: string,
  fields: FieldSpec[],
  opts: { ignoreSelectors: string[]; ignoreAttributes: string[]; ignoreRegexes: string[] },
): Record<string, string> {
  const $ = cheerio.load(html);

  $('script, style, noscript, template').remove();

  for (const sel of opts.ignoreSelectors) {
    try {
      $(sel).remove();
    } catch {
      throw new Error(`Invalid ignore selector: ${sel}`);
    }
  }

  for (const attrRaw of opts.ignoreAttributes) {
    const attr = attrRaw.trim();
    if (!attr) continue;
    if (!/^[a-zA-Z_][\\w:-]*$/.test(attr)) {
      throw new Error(`Invalid ignore attribute: ${attrRaw}`);
    }
    $('*').removeAttr(attr);
  }

  const compiledRegexes: RegExp[] = [];
  for (const pattern of opts.ignoreRegexes) {
    try {
      compiledRegexes.push(compileRegex(pattern));
    } catch {
      throw new Error(`Invalid ignore regex: ${pattern}`);
    }
  }

  const out: Record<string, string> = {};
  for (const field of fields) {
    let nodes: cheerio.Cheerio<AnyNode>;
    try {
      nodes = $(field.selector);
    } catch {
      throw new FieldExtractionError(field.name, `Invalid selector: ${field.selector}`);
    }

    if (nodes.length === 0) {
      throw new FieldExtractionError(field.name, `Selector matched 0 elements: ${field.selector}`);
    }

    let value: string;
    if (field.type === 'text') {
      value = nodes.text();
    } else {
      const first = nodes.first();
      const attr = first.attr(field.attribute);
      if (attr == null) {
        throw new FieldExtractionError(field.name, `Attribute missing: ${field.attribute}`);
      }
      value = attr;
    }

    for (const re of compiledRegexes) {
      value = value.replace(re, '');
    }

    out[field.name] = collapseWhitespace(value);
  }

  return out;
}

