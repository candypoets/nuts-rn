import type {
  NostrEvent as RawNostrEvent,
  ParsedEvent,
} from '@candypoets/nipworker';
import {
  Message,
  MessageType,
  ParsedData,
  ParsedEvent as FbParsedEvent,
  ParsedEventT,
  PipeConfig,
  PipeT,
  PreGenericParsedT,
  SaveToDbPipeConfigT,
  SerializeEventsPipeConfigT,
  StringVecT,
  WorkerMessage as FbWorkerMessage,
  WorkerMessageT,
} from '@candypoets/nipworker';
import { fbArray } from '@candypoets/nipworker/utils';
import { Builder, ByteBuffer } from 'flatbuffers';
import { naddrEncode, neventEncode } from 'nostr-tools/nip19';
import type { EventTemplate } from 'nostr-tools';

export const HIGHLIGHT_KIND = 9802 as const;

/** Highlights travel with note/repost feeds; they are never a separate tab. */
export function noteFeedIncludesHighlights(kinds: readonly number[]) {
  return kinds.includes(1) || kinds.includes(6);
}

type TagVector = {
  itemsLength(): number;
  items(index: number): string | null;
};

type FlatBufferTagReader = {
  tagsLength(): number;
  tags(index: number): TagVector | null;
};

export type HighlightSource =
  | { type: 'url'; url: string; label: string }
  | {
      type: 'address';
      address: string;
      relay?: string;
      label: string;
      path?: string;
    }
  | {
      type: 'event';
      id: string;
      relay?: string;
      label: string;
      path?: string;
    };

export type HighlightSourceReference = {
  address?: string;
  eventId?: string;
  url?: string;
  relay?: string;
  author?: string;
};

export function readFlatBufferTags(event: FlatBufferTagReader): string[][] {
  return fbArray(event, 'tags').map(tag =>
    fbArray(tag, 'items').map(item => item || ''),
  );
}

export function highlightEventPipeline(subId: string) {
  return [
    new PipeT(PipeConfig.SaveToDbPipeConfig, new SaveToDbPipeConfigT()),
    new PipeT(
      PipeConfig.SerializeEventsPipeConfig,
      new SerializeEventsPipeConfigT(subId),
    ),
  ];
}

/**
 * The worker's parsed-event pipeline does not retain generic kind content.
 * Materialize the one small ParsedEvent view Note/native header/footer need.
 *
 * Keep the ParsedEvent inside a WorkerMessage. Native note components receive
 * the FlatBuffer's backing bytes and decode them from the WorkerMessage root;
 * returning a standalone ParsedEvent leaves a recycled native header showing
 * the previous row when that decode fails.
 */
export function parsedHighlightFromRaw(
  event: RawNostrEvent,
  relays: string[],
): ParsedEvent | undefined {
  const id = event.id();
  const pubkey = event.pubkey();
  if (!id || !pubkey || event.kind() !== HIGHLIGHT_KIND) return undefined;

  const tags = readFlatBufferTags(event);
  const tagVectors = tags.map(tag => new StringVecT(tag));
  const highlight = new PreGenericParsedT();
  highlight.kind = HIGHLIGHT_KIND;
  highlight.content = event.content() || '';
  highlight.tags = tagVectors;

  const parsed = new ParsedEventT(
    id,
    pubkey,
    HIGHLIGHT_KIND,
    event.createdAt(),
    ParsedData.PreGenericParsed,
    highlight,
    [],
    relays,
    tagVectors,
  );
  const message = new WorkerMessageT(
    `highlight_${id}`,
    '',
    MessageType.ParsedNostrEvent,
    Message.ParsedEvent,
    parsed,
  );
  const builder = new Builder(2048);
  const offset = message.pack(builder);
  builder.finish(offset);
  const worker = FbWorkerMessage.getRootAsWorkerMessage(
    new ByteBuffer(builder.asUint8Array()),
  );
  return worker.content(new FbParsedEvent()) as ParsedEvent | undefined;
}

export function highlightTagValue(
  tags: readonly (readonly string[])[],
  name: string,
) {
  return tags.find(tag => tag[0] === name && Boolean(tag[1]))?.[1];
}

/** Remove common tracking parameters when a URL becomes a NIP-84 source. */
export function cleanHighlightUrl(value: string) {
  try {
    const url = new URL(value);
    const tracking = /^(utm_|fbclid$|gclid$|dclid$|mc_cid$|mc_eid$|ref$)/i;
    Array.from(url.searchParams.keys()).forEach(key => {
      if (tracking.test(key)) url.searchParams.delete(key);
    });
    return url.toString().split('#')[0];
  } catch {
    return value.trim();
  }
}

function addressPath(address: string, relay?: string) {
  const firstSeparator = address.indexOf(':');
  const secondSeparator = address.indexOf(':', firstSeparator + 1);
  if (firstSeparator < 1 || secondSeparator < 0) return undefined;

  const kind = Number(address.slice(0, firstSeparator));
  const pubkey = address.slice(firstSeparator + 1, secondSeparator);
  const identifier = address.slice(secondSeparator + 1);
  if (!Number.isInteger(kind) || !pubkey || !identifier) return undefined;

  try {
    return `naddr:${naddrEncode({
      kind,
      pubkey,
      identifier,
      relays: relay ? [relay] : [],
    })}`;
  } catch {
    return undefined;
  }
}

function eventPath(id: string, relay?: string) {
  try {
    return `nevent:${neventEncode({ id, relays: relay ? [relay] : [] })}`;
  } catch {
    return undefined;
  }
}

function urlLabel(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return 'Web source';
  }
}

function isWebUrl(value: string) {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

export function highlightSourceFromTags(
  tags: readonly (readonly string[])[],
): HighlightSource | undefined {
  const addressTag = tags.find(tag => tag[0] === 'a' && Boolean(tag[1]));
  if (addressTag?.[1]) {
    const relay = addressTag[2] || undefined;
    return {
      type: 'address',
      address: addressTag[1],
      relay,
      label: 'Nostr article',
      path: addressPath(addressTag[1], relay),
    };
  }

  const eventTag = tags.find(tag => tag[0] === 'e' && Boolean(tag[1]));
  if (eventTag?.[1]) {
    const relay = eventTag[2] || undefined;
    return {
      type: 'event',
      id: eventTag[1],
      relay,
      label: 'Nostr event',
      path: eventPath(eventTag[1], relay),
    };
  }

  const urlTag =
    tags.find(
      tag => tag[0] === 'r' && tag[3] === 'source' && Boolean(tag[1]),
    ) || tags.find(tag => tag[0] === 'r' && Boolean(tag[1]));
  if (!urlTag?.[1]) return undefined;

  const url = cleanHighlightUrl(urlTag[1]);
  if (!isWebUrl(url)) return undefined;
  return { type: 'url', url, label: urlLabel(url) };
}

export function buildHighlightEvent({
  content,
  createdAt,
  source,
  context,
}: {
  content: string;
  createdAt: number;
  source: HighlightSourceReference;
  context?: string;
}): EventTemplate {
  const tags: string[][] = [];
  const relay = source.relay || '';

  if (source.address) tags.push(['a', source.address, relay]);
  else if (source.eventId) tags.push(['e', source.eventId, relay]);
  else if (source.url)
    tags.push(['r', cleanHighlightUrl(source.url), '', 'source']);

  if (source.author) tags.push(['p', source.author, relay, 'author']);
  if (context?.trim()) tags.push(['context', context.trim()]);
  tags.push(['client', 'nutsrn']);

  return {
    kind: HIGHLIGHT_KIND,
    content: content.trim(),
    created_at: createdAt,
    tags,
  };
}
