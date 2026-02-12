import { z } from 'zod';
import type { BaselineMode, SentinelInput } from './types.js';

const httpUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'Must be an http(s) URL',
  });

const baselineModeSchema: z.ZodType<BaselineMode> = z.union([
  z.literal('store_only'),
  z.literal('notify'),
]);

const rawInputSchema = z
  .object({
    target_url: httpUrl,
    selector: z.string().trim().min(1).optional(),
    webhook_url: httpUrl,
    webhook_headers: z.record(z.string(), z.string()).optional(),
    webhook_secret: z.string().min(1).optional(),
    baseline_mode: baselineModeSchema.optional(),
    state_store_name: z.string().trim().min(1).optional(),
    timeout_secs: z.coerce.number().int().min(1).optional(),
    max_retries: z.coerce.number().int().min(0).optional(),
    retry_backoff_ms: z.coerce.number().int().min(0).optional(),
    ignore_selectors: z.array(z.string().trim().min(1)).optional(),
    ignore_regexes: z.array(z.string().trim().min(1)).optional(),
    debug: z.coerce.boolean().optional(),
  })
  .strict();

export function parseInput(raw: unknown): SentinelInput {
  const parsed = rawInputSchema.parse(raw ?? {});

  return {
    target_url: parsed.target_url,
    selector: parsed.selector,
    webhook_url: parsed.webhook_url,
    webhook_headers: parsed.webhook_headers ?? {},
    webhook_secret: parsed.webhook_secret,
    baseline_mode: parsed.baseline_mode ?? 'store_only',
    state_store_name: parsed.state_store_name ?? 'sentinel-state',
    timeout_secs: parsed.timeout_secs ?? 30,
    max_retries: parsed.max_retries ?? 3,
    retry_backoff_ms: parsed.retry_backoff_ms ?? 1000,
    ignore_selectors: parsed.ignore_selectors ?? [],
    ignore_regexes: parsed.ignore_regexes ?? [],
    debug: parsed.debug ?? false,
  };
}
