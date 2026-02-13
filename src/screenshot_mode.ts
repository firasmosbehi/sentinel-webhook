import type { KeyValueStore } from 'apify';
import { makeArtifactKey, putBinaryArtifact } from './artifacts.js';
import { capturePlaywrightScreenshot } from './playwright_screenshot.js';
import type { SentinelInput, WebhookArtifacts } from './types.js';

function toBuffer(value: unknown): Buffer | null {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return null;
}

export function baselineScreenshotKey(stateKey: string): string {
  return `baseline-screenshot-${stateKey}.png`;
}

export function screenshotSelectorForInput(input: SentinelInput): string | undefined {
  if (input.screenshot_scope !== 'selector') return undefined;
  return input.screenshot_selector ?? input.selector;
}

export async function captureAndStoreBaselineScreenshot(
  input: SentinelInput,
  deps: { artifacts: KeyValueStore; stateKey: string },
): Promise<Buffer | null> {
  if (!input.screenshot_on_change) return null;
  if (input.rendering_mode !== 'playwright') return null;

  const selectorForShot = screenshotSelectorForInput(input);
  const shot = await capturePlaywrightScreenshot(input, {
    url: input.target_url,
    scope: input.screenshot_scope,
    selector: selectorForShot,
  });

  await putBinaryArtifact(deps.artifacts, input.artifact_store_name, baselineScreenshotKey(deps.stateKey), shot.png, 'image/png');
  return shot.png;
}

export async function captureAndStoreChangeScreenshots(
  input: SentinelInput,
  deps: { artifacts: KeyValueStore; stateKey: string; eventId: string },
): Promise<{ screenshots: NonNullable<WebhookArtifacts['screenshots']>; afterPng: Buffer } | null> {
  if (!input.screenshot_on_change) return null;
  if (input.rendering_mode !== 'playwright') return null;

  const selectorForShot = screenshotSelectorForInput(input);

  let before: NonNullable<WebhookArtifacts['screenshots']>['before'] | undefined;
  const baselineVal = await deps.artifacts.getValue<unknown>(baselineScreenshotKey(deps.stateKey));
  const baselinePng = toBuffer(baselineVal);
  if (baselinePng) {
    const beforeKey = makeArtifactKey({ stateKey: deps.stateKey, eventId: deps.eventId, name: 'screenshot_before.png' });
    before = await putBinaryArtifact(deps.artifacts, input.artifact_store_name, beforeKey, baselinePng, 'image/png');
  }

  const shot = await capturePlaywrightScreenshot(input, {
    url: input.target_url,
    scope: input.screenshot_scope,
    selector: selectorForShot,
  });

  const afterKey = makeArtifactKey({ stateKey: deps.stateKey, eventId: deps.eventId, name: 'screenshot_after.png' });
  const after = await putBinaryArtifact(deps.artifacts, input.artifact_store_name, afterKey, shot.png, 'image/png');

  return {
    screenshots: {
      before,
      after,
      scope: input.screenshot_scope,
      selector: selectorForShot,
    },
    afterPng: shot.png,
  };
}

export async function updateBaselineScreenshot(
  input: SentinelInput,
  deps: { artifacts: KeyValueStore; stateKey: string; png: Buffer },
): Promise<void> {
  if (!input.screenshot_on_change) return;
  if (input.rendering_mode !== 'playwright') return;
  await putBinaryArtifact(deps.artifacts, input.artifact_store_name, baselineScreenshotKey(deps.stateKey), deps.png, 'image/png');
}

