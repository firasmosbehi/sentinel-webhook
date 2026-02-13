import type { KeyValueStore } from 'apify';

export type ArtifactRef = {
  store_name: string;
  key: string;
  content_type: string;
  bytes: number;
};

export function makeArtifactKey(opts: { stateKey: string; eventId: string; name: string }): string {
  const safeName = opts.name.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `artifact-${opts.stateKey}-${opts.eventId}-${safeName}`;
}

export async function putTextArtifact(
  store: KeyValueStore,
  storeName: string,
  key: string,
  text: string,
  contentType: string,
): Promise<ArtifactRef> {
  const bytes = Buffer.byteLength(text, 'utf8');
  await store.setValue(key, text, { contentType });
  return { store_name: storeName, key, content_type: contentType, bytes };
}

export async function putBinaryArtifact(
  store: KeyValueStore,
  storeName: string,
  key: string,
  data: Buffer,
  contentType: string,
): Promise<ArtifactRef> {
  const bytes = data.byteLength;
  await store.setValue(key, data, { contentType });
  return { store_name: storeName, key, content_type: contentType, bytes };
}

export async function putJsonArtifact(
  store: KeyValueStore,
  storeName: string,
  key: string,
  value: unknown,
): Promise<ArtifactRef> {
  const text = JSON.stringify(value);
  return putTextArtifact(store, storeName, key, text, 'application/json; charset=utf-8');
}
