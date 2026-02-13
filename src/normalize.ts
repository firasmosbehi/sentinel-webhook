import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';

export class EmptySelectorMatchError extends Error {
  public readonly selector: string;

  constructor(selector: string) {
    super(`Selector matched 0 elements: ${selector}`);
    this.name = 'EmptySelectorMatchError';
    this.selector = selector;
  }
}

export type NormalizeOptions = {
  selector?: string;
  ignoreSelectors: string[];
  ignoreAttributes: string[];
  ignoreRegexes: string[];
};

function compileRegex(pattern: string): RegExp {
  // Allow either:
  // - plain pattern: "foo\\d+" => /foo\d+/g
  // - slash form: "/foo\\d+/gi" => /foo\d+/gi (ensure global)
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

export function normalizeHtmlToSnapshot(html: string, opts: NormalizeOptions): { text: string; html?: string } {
  const $ = cheerio.load(html);

  // Always remove the most common noise sources.
  $('script, style, noscript, template').remove();

  for (const sel of opts.ignoreSelectors) {
    try {
      $(sel).remove();
    } catch {
      // Invalid selectors should be a hard error for predictable behavior.
      throw new Error(`Invalid ignore selector: ${sel}`);
    }
  }

  for (const attrRaw of opts.ignoreAttributes) {
    const attr = attrRaw.trim();
    if (!attr) continue;
    if (!/^[a-zA-Z_][\\w:-]*$/.test(attr)) {
      throw new Error(`Invalid ignore attribute: ${attrRaw}`);
    }
    // Remove attribute from all elements (Cheerio will no-op where absent).
    $('*').removeAttr(attr);
  }

  let pickedHtml: string | undefined;
  let pickedText: string;

  if (opts.selector) {
    let nodes: cheerio.Cheerio<AnyNode>;
    try {
      nodes = $(opts.selector);
    } catch {
      throw new Error(`Invalid selector: ${opts.selector}`);
    }

    if (nodes.length === 0) {
      throw new EmptySelectorMatchError(opts.selector);
    }

    pickedHtml = nodes
      .toArray()
      .map((el: AnyNode) => $.html(el))
      .join('\n');

    pickedText = nodes.text();
  } else {
    const body = $('body');
    pickedHtml = body.length ? body.html() ?? undefined : $.root().html() ?? undefined;
    pickedText = body.length ? body.text() : $.root().text();
  }

  for (const pattern of opts.ignoreRegexes) {
    let re: RegExp;
    try {
      re = compileRegex(pattern);
    } catch {
      throw new Error(`Invalid ignore regex: ${pattern}`);
    }
    pickedText = pickedText.replace(re, '');
  }

  // Collapse whitespace for stability across formatting-only changes.
  pickedText = pickedText.replace(/\s+/g, ' ').trim();

  return { text: pickedText, html: pickedHtml };
}
