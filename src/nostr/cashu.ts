import {Mint} from '@cashu/cashu-ts';
import type {ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {useSubscription as subscribeToNostr} from '@candypoets/nipworker/hooks';
import {asConnectionStatus, asParsedEvent} from '@candypoets/nipworker/utils';
import type {EventTemplate} from 'nostr-tools';

const CASHU_MINT_ANNOUNCEMENT_KIND = 38172;
const CASHU_MINT_RECOMMENDATION_KIND = 38000;
const DISCOVERY_TIMEOUT_MS = 3_000;
const MINT_INFO_TIMEOUT_MS = 4_000;

export type RecommendedCashuMint = {
  mint: string;
  recommendationCount: number;
  announcement?: {
    pubkey: string;
    d: string;
  };
};

type MintAnnouncement = {
  pubkey: string;
  d: string;
  mint: string;
  network?: string;
};

function eventTags(event: ParsedEvent) {
  const tags: string[][] = [];
  for (let index = 0; index < event.tagsLength(); index += 1) {
    const tag = event.tags(index);
    if (!tag) continue;
    const values: string[] = [];
    for (let item = 0; item < tag.itemsLength(); item += 1) {
      values.push(String(tag.items(item) || ''));
    }
    tags.push(values);
  }
  return tags;
}

export function normalizeCashuMintUrl(url: string) {
  let value = url.trim();
  if (!value) return '';
  if (value.startsWith('http://')) value = value.replace(/^http:/, 'https:');
  if (!value.startsWith('https://')) return '';
  return value.replace(/\/$/, '');
}

function firstCashuUrl(tags: string[][]) {
  for (const tag of tags) {
    if (tag[0] !== 'u' || !tag[1]) continue;
    if (tag[2] && tag[2].toLowerCase() !== 'cashu') continue;
    const mint = normalizeCashuMintUrl(tag[1]);
    if (mint) return mint;
  }
  return '';
}

function tagValue(tags: string[][], name: string) {
  return tags.find(tag => tag[0] === name && tag[1])?.[1] || '';
}

function announcementKey(pubkey: string, d: string) {
  return `${pubkey}:${d}`;
}

function parseAnnouncement(event: ParsedEvent): MintAnnouncement | null {
  if (event.kind() !== CASHU_MINT_ANNOUNCEMENT_KIND) return null;
  const tags = eventTags(event);
  const mint = firstCashuUrl(tags);
  const d = tagValue(tags, 'd');
  const pubkey = event.pubkey() || '';
  if (!mint || !d || !pubkey) return null;
  return {
    pubkey,
    d,
    mint,
    network: tagValue(tags, 'n') || undefined,
  };
}

function recommendationUrls(
  event: ParsedEvent,
  announcements: Map<string, MintAnnouncement>,
) {
  const tags = eventTags(event);
  const recommendationId = tagValue(tags, 'd') || event.id() || '';
  const directMint = firstCashuUrl(tags);
  if (directMint) {
    return [{
      mint: directMint,
      identity: `${recommendationId}:${directMint}`,
      announcement: undefined,
    }];
  }

  const d = tagValue(tags, 'd');
  if (d && normalizeCashuMintUrl(d)) {
    const mint = normalizeCashuMintUrl(d);
    return [{mint, identity: `${recommendationId}:${mint}`, announcement: undefined}];
  }

  for (const tag of tags) {
    if (tag[0] !== 'a' || !tag[1]) continue;
    const parts = tag[1].split(':');
    if (parts[0] !== String(CASHU_MINT_ANNOUNCEMENT_KIND) || parts.length < 3) {
      continue;
    }
    const key = announcementKey(parts[1], parts.slice(2).join(':'));
    const announcement = announcements.get(key);
    if (announcement) {
      return [{
        mint: announcement.mint,
        identity: `${recommendationId}:${announcement.mint}`,
        announcement,
      }];
    }
  }

  return [];
}

function latestEventsByAuthorAndMint(events: ParsedEvent[], announcements: Map<string, MintAnnouncement>) {
  const latest = new Map<string, {
    mint: string;
    recommender: string;
    createdAt: number;
    announcement?: MintAnnouncement;
  }>();

  for (const event of events) {
    if (event.kind() !== CASHU_MINT_RECOMMENDATION_KIND) continue;
    const recommender = event.pubkey() || event.id() || '';
    if (!recommender) continue;
    const createdAt = event.createdAt() || 0;
    for (const candidate of recommendationUrls(event, announcements)) {
      const key = `${recommender}:${candidate.identity}`;
      const previous = latest.get(key);
      if (!previous || createdAt > previous.createdAt) {
        latest.set(key, {
          mint: candidate.mint,
          recommender,
          createdAt,
          announcement: candidate.announcement,
        });
      }
    }
  }

  return latest;
}

export function rankCashuMintRecommendations(
  events: ParsedEvent[],
  announcements: Map<string, MintAnnouncement> = new Map(),
) {
  const latest = latestEventsByAuthorAndMint(events, announcements);
  const ranked = new Map<string, RecommendedCashuMint & {latestCreatedAt: number}>();

  for (const entry of latest.values()) {
    const current = ranked.get(entry.mint);
    if (current) {
      current.recommendationCount += 1;
      current.latestCreatedAt = Math.max(current.latestCreatedAt, entry.createdAt);
      if (!current.announcement && entry.announcement) {
        current.announcement = {
          pubkey: entry.announcement.pubkey,
          d: entry.announcement.d,
        };
      }
      continue;
    }
    ranked.set(entry.mint, {
      mint: entry.mint,
      recommendationCount: 1,
      latestCreatedAt: entry.createdAt,
      announcement: entry.announcement
        ? {pubkey: entry.announcement.pubkey, d: entry.announcement.d}
        : undefined,
    });
  }

  return Array.from(ranked.values())
    .sort((left, right) =>
      right.recommendationCount - left.recommendationCount ||
      right.latestCreatedAt - left.latestCreatedAt ||
      left.mint.localeCompare(right.mint),
    )
    .map(({latestCreatedAt: _latestCreatedAt, ...mint}) => mint);
}

function isEose(message: WorkerMessage) {
  return asConnectionStatus(message)?.status()?.toString().toLowerCase() === 'eose';
}

async function mintIsReachable(mintUrl: string) {
  try {
    await Promise.race([
      new Mint(mintUrl).getInfo(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('mint info timeout')), MINT_INFO_TIMEOUT_MS),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

export function discoverRecommendedCashuMint(
  relays: string[],
  authors: string[] = [],
): Promise<RecommendedCashuMint | null> {
  const resolvedRelays = Array.from(new Set(relays.filter(Boolean)));
  if (!resolvedRelays.length) return Promise.resolve(null);

  return new Promise(resolve => {
    const recommendationEvents: ParsedEvent[] = [];
    const announcements = new Map<string, MintAnnouncement>();
    let settled = false;
    let eoseCount = 0;
    let unsubscribe: (() => void) | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe?.();
      const ranked = rankCashuMintRecommendations(recommendationEvents, announcements);
      (async () => {
        const candidates = ranked.slice(0, 8);
        const reachable = await Promise.all(
          candidates.map(candidate => mintIsReachable(candidate.mint)),
        );
        resolve(candidates.find((_candidate, index) => reachable[index]) || null);
      })();
    };

    const timeout = setTimeout(finish, DISCOVERY_TIMEOUT_MS);
    unsubscribe = subscribeToNostr(
      `cashu_mint_discovery_${resolvedRelays.join('|')}_${authors.join('|')}`,
      [
        {
          kinds: [CASHU_MINT_RECOMMENDATION_KIND],
          ...(authors.length ? {authors} : {}),
          tags: {'#k': [String(CASHU_MINT_ANNOUNCEMENT_KIND)]},
          limit: 500,
          relays: resolvedRelays,
        },
        {
          kinds: [CASHU_MINT_ANNOUNCEMENT_KIND],
          limit: 500,
          relays: resolvedRelays,
        },
      ],
      (message: WorkerMessage) => {
        if (isEose(message)) {
          eoseCount += 1;
          if (eoseCount >= resolvedRelays.length * 2) finish();
          return;
        }
        const event = asParsedEvent(message);
        if (!event) return;
        const announcement = parseAnnouncement(event);
        if (announcement) {
          announcements.set(announcementKey(announcement.pubkey, announcement.d), announcement);
        } else if (event.kind() === CASHU_MINT_RECOMMENDATION_KIND) {
          recommendationEvents.push(event);
        }
      },
      {closeOnEose: false},
    );
  });
}

export function cashuMintRecommendationEvent(
  mint: RecommendedCashuMint,
): EventTemplate {
  const tags: string[][] = [
    ['alt', 'Cashu mint recommendation'],
    ['d', mint.mint],
    ['k', String(CASHU_MINT_ANNOUNCEMENT_KIND)],
    ['u', mint.mint, 'cashu'],
    ['method', 'nostr-recommendation-count'],
    ['client', 'nuts-rn'],
  ];
  if (mint.announcement) {
    tags.push([
      'a',
      `${CASHU_MINT_ANNOUNCEMENT_KIND}:${mint.announcement.pubkey}:${mint.announcement.d}`,
    ]);
  }
  return {
    kind: CASHU_MINT_RECOMMENDATION_KIND,
    content: `Selected by Nuts RN from ${mint.recommendationCount} unique Nostr recommendation${mint.recommendationCount === 1 ? '' : 's'}.`,
    created_at: Math.floor(Date.now() / 1000),
    tags,
  };
}
