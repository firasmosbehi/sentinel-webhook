import { Actor } from 'apify';
import type { Route } from 'playwright';
import { assertUrlAllowedByDomainPolicy } from './domain_policy.js';
import { normalizeHttpUrl } from './url_normalize.js';
import { assertSafeHttpUrl } from './url_safety.js';
import { waitForPoliteness } from './politeness.js';
import { assertRobotsAllowed } from './robots.js';
import type { SentinelInput } from './types.js';

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const want = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === want);
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

function stripHeader(headers: Record<string, string>, name: string): Record<string, string> {
  const want = name.toLowerCase();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === want) continue;
    out[k] = v;
  }
  return out;
}

async function resolveProxyUrl(proxy_configuration: SentinelInput['proxy_configuration']): Promise<string | null> {
  if (!proxy_configuration) return null;

  if (proxy_configuration.proxy_urls && proxy_configuration.proxy_urls.length > 0) {
    return proxy_configuration.proxy_urls[0] ?? null;
  }

  if (proxy_configuration.use_apify_proxy) {
    const cfg = await Actor.createProxyConfiguration({
      useApifyProxy: true,
      apifyProxyGroups: proxy_configuration.apify_proxy_groups,
      apifyProxyCountry: proxy_configuration.apify_proxy_country,
    });
    if (!cfg) throw new Error('Proxy configuration requested but could not be created.');
    const next = await cfg.newUrl();
    if (!next) throw new Error('Proxy configuration did not produce a proxy URL.');
    return next;
  }

  return null;
}

function toPlaywrightProxy(proxyUrl: string): { server: string; username?: string; password?: string } {
  const u = new URL(proxyUrl);
  const out: { server: string; username?: string; password?: string } = { server: u.origin };
  if (u.username) out.username = u.username;
  if (u.password) out.password = u.password;
  return out;
}

export async function capturePlaywrightScreenshot(
  input: SentinelInput,
  opts: { url: string; scope: 'full_page' | 'selector'; selector?: string },
): Promise<{ png: Buffer; finalUrl: string }> {
  const { chromium } = await import('playwright');

  const allowLocalhost = input.allow_localhost && !(Actor.getEnv().isAtHome ?? false);
  const url = normalizeHttpUrl(opts.url);

  assertUrlAllowedByDomainPolicy(url, 'target_url', {
    allowlist: input.target_domain_allowlist,
    denylist: input.target_domain_denylist,
  });
  await assertSafeHttpUrl(url, 'target_url', { allowLocalhost });

  const proxyUrl = await resolveProxyUrl(input.proxy_configuration);
  const launchOpts: { headless: boolean; proxy?: { server: string; username?: string; password?: string } } = {
    headless: true,
  };
  if (proxyUrl) launchOpts.proxy = toPlaywrightProxy(proxyUrl);

  const userAgent =
    getHeader(input.fetch_headers, 'user-agent') ?? 'SentinelWebhook/0.1 (+https://github.com/firasmosbehi/sentinel-webhook)';
  const extraHeaders = stripHeader(input.fetch_headers, 'user-agent');
  if (!hasHeader(extraHeaders, 'accept')) {
    extraHeaders.accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
  }

  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({ userAgent, extraHTTPHeaders: extraHeaders });
    try {
      if (input.target_cookies.length > 0) {
        await context.addCookies(
          input.target_cookies.map((c) => ({
            name: c.name,
            value: c.value,
            url: c.domain ? undefined : url,
            domain: c.domain,
            path: c.path ?? '/',
            expires: c.expires,
            httpOnly: c.httpOnly,
            secure: c.secure,
            sameSite: c.sameSite,
          })),
        );
      }

      const page = await context.newPage();

      await page.route('**/*', async (route: Route) => {
        const req = route.request();
        const rurl = req.url();
        const resourceType = req.resourceType();
        if (input.playwright_block_resources && (resourceType === 'image' || resourceType === 'media' || resourceType === 'font')) {
          await route.abort();
          return;
        }
        if (!rurl.startsWith('http://') && !rurl.startsWith('https://')) {
          await route.abort();
          return;
        }
        try {
          await assertSafeHttpUrl(rurl, 'playwright_request', { allowLocalhost });
        } catch {
          await route.abort();
          return;
        }
        await route.continue();
      });

      await waitForPoliteness(url, input.politeness_delay_ms, input.politeness_jitter_ms);
      if (input.robots_txt_mode === 'respect') {
        await assertRobotsAllowed(url, userAgent, { timeoutSecs: Math.min(10, input.fetch_timeout_secs), allowOnError: true });
      }

      const nav = await page.goto(url, { waitUntil: input.wait_until, timeout: input.fetch_timeout_secs * 1000 });
      if (!nav) throw new Error('Playwright navigation failed (no response).');

      const finalUrl = normalizeHttpUrl(nav.url());
      assertUrlAllowedByDomainPolicy(finalUrl, 'target_url', {
        allowlist: input.target_domain_allowlist,
        denylist: input.target_domain_denylist,
      });
      await assertSafeHttpUrl(finalUrl, 'target_url', { allowLocalhost });

      const waitSel = input.wait_for_selector ?? input.selector;
      if (waitSel) {
        await page.waitForSelector(waitSel, { timeout: input.wait_for_selector_timeout_secs * 1000 });
      }

      let png: Buffer;
      if (opts.scope === 'selector') {
        const selector = opts.selector ?? input.selector;
        if (!selector) throw new Error('screenshot_scope=selector requires selector or screenshot_selector.');
        const loc = page.locator(selector).first();
        await loc.waitFor({ state: 'visible', timeout: input.wait_for_selector_timeout_secs * 1000 });
        png = await loc.screenshot({ type: 'png' });
      } else {
        png = await page.screenshot({ type: 'png', fullPage: true });
      }

      return { png, finalUrl };
    } finally {
      try {
        await context.close();
      } catch {
        // ignore
      }
    }
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
}

