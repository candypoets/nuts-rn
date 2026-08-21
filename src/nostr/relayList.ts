import type {EventTemplate} from 'nostr-tools';

export type RelayListMarker = {
  url: string;
  read: boolean;
  write: boolean;
};

export function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

export function uniqueRelays(relays: string[]) {
  return Array.from(
    new Set(relays.map(normalizeRelayUrl).filter(Boolean)),
  );
}

export function buildRelayMarkers(
  readUrls: string[],
  writeUrls: string[],
): RelayListMarker[] {
  const readSet = new Set(readUrls.map(normalizeRelayUrl));
  const writeSet = new Set(writeUrls.map(normalizeRelayUrl));
  const allUrls = Array.from(new Set([...readSet, ...writeSet])).sort();

  return allUrls.map(url => ({
    url,
    read: readSet.has(url),
    write: writeSet.has(url),
  }));
}

export function buildRelayListTags(readUrls: string[], writeUrls: string[]) {
  return buildRelayMarkers(readUrls, writeUrls).map(relay => {
    if (relay.read && relay.write) return ['r', relay.url];
    return ['r', relay.url, relay.read ? 'read' : 'write'];
  });
}

export function buildRelayListPublishPlan({
  readRelays,
  writeRelays,
  discoveryRelays = [],
  createdAt,
}: {
  readRelays: string[];
  writeRelays: string[];
  discoveryRelays?: string[];
  createdAt: number;
}) {
  const normalizedReadRelays = uniqueRelays(readRelays);
  const normalizedWriteRelays = uniqueRelays(writeRelays);
  const markers = buildRelayMarkers(
    normalizedReadRelays,
    normalizedWriteRelays,
  );
  const event: EventTemplate = {
    kind: 10002,
    created_at: createdAt,
    content: '',
    tags: buildRelayListTags(normalizedReadRelays, normalizedWriteRelays),
  };

  return {
    event,
    markers,
    publishRelays: uniqueRelays([
      ...normalizedWriteRelays,
      ...normalizedReadRelays,
      ...discoveryRelays,
    ]),
    readRelays: normalizedReadRelays,
    writeRelays: normalizedWriteRelays,
  };
}
