import {
  type RelayInfo,
  type RelayInfoEntry,
  useRelayStore,
} from '../stores/relayStore';

const NIP11_SUCCESS_TTL_MS = 24 * 60 * 60 * 1000;
const NIP11_FAILURE_TTL_MS = 10 * 60 * 1000;
const NIP11_TIMEOUT_MS = 5000;
const NIP11_CONCURRENCY = 3;

const pendingFetches = new Map<string, Promise<void>>();
const HIDDEN_ADMIN_RELAY_URLS = new Set(['wss://miss-tourisma.relays.nuts.cash']);

export function normalizeRelayUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

export function isHiddenAdminRelay(url: string) {
  return HIDDEN_ADMIN_RELAY_URLS.has(normalizeRelayUrl(url));
}

function relayHttpUrl(url: string) {
  const normalized = normalizeRelayUrl(url);
  if (/^wss:\/\//i.test(normalized)) {
    return normalized.replace(/^wss:\/\//i, 'https://');
  }
  if (/^ws:\/\//i.test(normalized)) {
    return normalized.replace(/^ws:\/\//i, 'http://');
  }
  return normalized;
}

function shouldFetchRelayInfo(entry?: RelayInfoEntry) {
  if (!entry) return true;
  if (entry.status === 'loading') return false;

  const fetchedAt = entry.fetchedAt ?? 0;
  const ttl =
    entry.status === 'ok' ? NIP11_SUCCESS_TTL_MS : NIP11_FAILURE_TTL_MS;

  return Date.now() - fetchedAt > ttl;
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : undefined;
}

function arrayOfNumbers(value: unknown) {
  return Array.isArray(value)
    ? value.map(item => Number(item)).filter(item => Number.isFinite(item))
    : undefined;
}

function recordValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseRelayInfo(value: unknown): RelayInfo {
  const json = recordValue(value);
  if (!json) throw new Error('Relay returned invalid NIP-11 metadata');

  return {
    name: stringValue(json.name),
    description: stringValue(json.description),
    banner: stringValue(json.banner),
    icon: stringValue(json.icon),
    pubkey: stringValue(json.pubkey),
    self: stringValue(json.self),
    contact: stringValue(json.contact),
    supported_nips: arrayOfNumbers(json.supported_nips),
    software: stringValue(json.software),
    version: stringValue(json.version),
    limitation: recordValue(json.limitation),
    retention: Array.isArray(json.retention) ? json.retention : undefined,
    relay_countries: arrayOfStrings(json.relay_countries),
    language_tags: arrayOfStrings(json.language_tags),
    tags: arrayOfStrings(json.tags),
    posting_policy: stringValue(json.posting_policy),
    payments_url: stringValue(json.payments_url),
    fees: recordValue(json.fees),
  };
}

async function fetchRelayInfo(url: string) {
  const normalized = normalizeRelayUrl(url);
  const existing = pendingFetches.get(normalized);
  if (existing) return existing;

  const request = (async () => {
    const store = useRelayStore.getState();
    store.setRelayInfoLoading(normalized);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NIP11_TIMEOUT_MS);

    try {
      const response = await fetch(relayHttpUrl(normalized), {
        headers: { Accept: 'application/nostr+json' },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`NIP-11 request failed with ${response.status}`);
      }
      const info = parseRelayInfo(await response.json());
      useRelayStore.getState().setRelayInfo(normalized, info);
    } catch (error) {
      useRelayStore
        .getState()
        .setRelayInfoError(
          normalized,
          error instanceof Error ? error.message : 'Failed to load NIP-11 info',
        );
    } finally {
      clearTimeout(timeout);
      pendingFetches.delete(normalized);
    }
  })();

  pendingFetches.set(normalized, request);
  return request;
}

async function runLimited<T>(
  values: T[],
  limit: number,
  worker: (value: T) => Promise<void>,
) {
  let index = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (index < values.length) {
        const value = values[index];
        index += 1;
        await worker(value);
      }
    },
  );
  await Promise.all(workers);
}

export function fetchRelayInfosForRelays(relays: string[]) {
  const store = useRelayStore.getState();
  const urls = [
    ...new Set(relays.map(normalizeRelayUrl).filter(Boolean)),
  ].filter(url => shouldFetchRelayInfo(store.relayInfos[url]));

  if (!urls.length) return Promise.resolve();
  return runLimited(urls, NIP11_CONCURRENCY, fetchRelayInfo);
}
