import { useSignEvent } from '@candypoets/nipworker/hooks';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import type { Event, EventTemplate } from 'nostr-tools';

export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.nuts.cash';
export const DEFAULT_UPLOAD_SERVER = DEFAULT_BLOSSOM_SERVER;
export type UploadServerType = 'blossom' | 'nip96';

export type LocalUploadAsset = {
  uri: string;
  width: number;
  height: number;
  mimeType?: string | null;
  fileName?: string | null;
};

export type UploadResult = {
  url: string;
  sha256: string;
  tags: string[][];
};

/* eslint-disable no-bitwise */
function base64Encode(value: string) {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let output = '';
  let index = 0;

  while (index < value.length) {
    const chr1 = value.charCodeAt(index++);
    const chr2 = value.charCodeAt(index++);
    const chr3 = value.charCodeAt(index++);
    const enc1 = chr1 >> 2;
    const enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
    const enc3 = Number.isNaN(chr2) ? 64 : ((chr2 & 15) << 2) | (chr3 >> 6);
    const enc4 = Number.isNaN(chr3) ? 64 : chr3 & 63;
    output +=
      chars.charAt(enc1) +
      chars.charAt(enc2) +
      chars.charAt(enc3) +
      chars.charAt(enc4);
  }

  return output;
}
/* eslint-enable no-bitwise */

function readBlobAsArrayBuffer(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to read file bytes'));
      }
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error('Failed to read file'));
    reader.readAsArrayBuffer(blob);
  });
}

function signEvent(template: EventTemplate) {
  return new Promise<Event>((resolve, reject) => {
    try {
      useSignEvent(template, signedEvent => {
        if (typeof signedEvent === 'string') {
          resolve(JSON.parse(signedEvent));
          return;
        }
        resolve(signedEvent);
      });
    } catch (error) {
      reject(error);
    }
  });
}

function canonicalAuthEvent(signed: Event) {
  if (!signed.id || !signed.pubkey || !signed.sig) {
    throw new Error('Failed to sign upload authorization');
  }

  return {
    id: signed.id,
    pubkey: signed.pubkey,
    created_at: signed.created_at,
    kind: signed.kind,
    tags: signed.tags,
    content: signed.content,
    sig: signed.sig,
  };
}

async function makeBlossomAuthHeader(sha256Hex: string) {
  const signed = await signEvent({
    kind: 24242,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['t', 'upload'],
      ['x', sha256Hex],
      ['expiration', String(Math.floor(Date.now() / 1000) + 3600)],
    ],
    content: '',
  });

  return `Nostr ${base64Encode(JSON.stringify(canonicalAuthEvent(signed)))}`;
}

async function makeNip98AuthHeader(
  url: string,
  method: string,
  payloadHash: string,
) {
  const signed = await signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['u', url],
      ['method', method],
      ['payload', payloadHash],
    ],
    content: '',
  });

  return `Nostr ${base64Encode(JSON.stringify(canonicalAuthEvent(signed)))}`;
}

function normalizeUploadUrl(url: string) {
  return url.replace(/^https?:\/\/https?:\/\//i, 'https://');
}

function nip94Tags(asset: LocalUploadAsset, sha256Hex: string, url: string) {
  const tags: string[][] = [
    ['url', url],
    ['x', sha256Hex],
  ];

  if (asset.mimeType) tags.push(['m', asset.mimeType]);
  if (asset.width && asset.height) {
    tags.push([
      'dim',
      `${Math.round(asset.width)}x${Math.round(asset.height)}`,
    ]);
  }
  if (asset.fileName) tags.push(['alt', asset.fileName]);

  return tags;
}

async function readLocalAsset(asset: LocalUploadAsset) {
  const response = await fetch(asset.uri);
  const blob = await response.blob();
  const bytes = new Uint8Array(await readBlobAsArrayBuffer(blob));
  const sha256Hex = bytesToHex(sha256(bytes));
  const mimeType =
    asset.mimeType || blob.type || response.headers.get('content-type') || '';

  return { blob, sha256Hex, mimeType };
}

export async function uploadToBlossom(
  asset: LocalUploadAsset,
  server = DEFAULT_BLOSSOM_SERVER,
): Promise<UploadResult> {
  const { blob, sha256Hex, mimeType } = await readLocalAsset(asset);
  const uploadUrl = `${server.replace(/\/$/, '')}/upload`;
  const authorization = await makeBlossomAuthHeader(sha256Hex);
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'X-SHA-256': sha256Hex,
      'Content-Type': mimeType || 'application/octet-stream',
    },
    body: blob,
  });

  if (!uploadResponse.ok) {
    const reason =
      uploadResponse.headers.get('x-reason') ||
      uploadResponse.headers.get('X-Reason') ||
      (await uploadResponse.text().catch(() => ''));
    throw new Error(
      `Blossom upload failed with status ${uploadResponse.status}: ${reason}`,
    );
  }

  const json = await uploadResponse.json().catch(() => null as any);
  const url = normalizeUploadUrl(String(json?.url || uploadUrl));

  return {
    url,
    sha256: sha256Hex,
    tags: nip94Tags({ ...asset, mimeType }, sha256Hex, url),
  };
}

async function discoverNip96UploadUrl(baseUrl: string) {
  try {
    const wellKnown = new URL(
      '/.well-known/nostr/nip96.json',
      baseUrl,
    ).toString();
    const response = await fetch(wellKnown);
    if (response.ok) {
      const json = await response.json();
      if (json?.api_url) return String(json.api_url);
      if (json?.upload) return String(json.upload);
      if (json?.endpoints?.upload) return String(json.endpoints.upload);
    }
  } catch {
    // Fallback below.
  }

  return new URL('/api/v2/media', baseUrl).toString();
}

function extractUploadedUrl(json: any): string | null {
  return (
    json?.nip94_event?.tags?.find((tag: string[]) => tag?.[0] === 'url')?.[1] ||
    json?.url ||
    json?.result?.url ||
    json?.data?.url ||
    json?.nurl ||
    null
  );
}

export async function uploadToNip96(
  asset: LocalUploadAsset,
  server = DEFAULT_UPLOAD_SERVER,
): Promise<UploadResult> {
  const { sha256Hex, mimeType } = await readLocalAsset(asset);
  const uploadUrl = await discoverNip96UploadUrl(server);
  const authorization = await makeNip98AuthHeader(uploadUrl, 'POST', sha256Hex);
  const form = new FormData();

  form.append('file', {
    uri: asset.uri,
    name: asset.fileName || `upload-${sha256Hex.slice(0, 12)}`,
    type: mimeType || 'application/octet-stream',
  } as any);

  const uploadResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: { Authorization: authorization },
    body: form,
  });
  const json = await uploadResponse.json().catch(() => null as any);
  const uploadedUrl = extractUploadedUrl(json);

  if (!uploadResponse.ok || !uploadedUrl) {
    throw new Error(
      String(
        json?.message ||
          `NIP-96 upload failed with status ${uploadResponse.status}`,
      ),
    );
  }

  const url = normalizeUploadUrl(uploadedUrl);
  const tags = nip94Tags({ ...asset, mimeType }, sha256Hex, url);
  const exclude = new Set(['url', 'x', 'ox', 'm', 'size']);
  const serverTags: string[][] = json?.nip94_event?.tags || [];

  for (const tag of serverTags) {
    if (Array.isArray(tag) && tag.length >= 2 && !exclude.has(tag[0])) {
      tags.push([tag[0], tag[1]]);
    }
  }

  return { url, sha256: sha256Hex, tags };
}

export function uploadFile(
  asset: LocalUploadAsset,
  config?: { server?: string; serverType?: UploadServerType },
) {
  const server = config?.server || DEFAULT_UPLOAD_SERVER;
  const serverType = config?.serverType || 'blossom';

  if (serverType === 'nip96') {
    return uploadToNip96(asset, server);
  }

  return uploadToBlossom(asset, server);
}
