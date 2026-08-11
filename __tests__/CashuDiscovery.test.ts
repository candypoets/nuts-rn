import type {ParsedEvent} from '@candypoets/nipworker';

import {
  cashuMintRecommendationEvent,
  rankCashuMintRecommendations,
} from '../src/nostr/cashu';

function parsedEvent(input: {
  id: string;
  kind: number;
  pubkey: string;
  createdAt: number;
  tags: string[][];
}): ParsedEvent {
  const tags = input.tags.map(items => ({
    itemsLength: () => items.length,
    items: (index: number) => items[index],
  }));
  return {
    id: () => input.id,
    kind: () => input.kind,
    pubkey: () => input.pubkey,
    createdAt: () => input.createdAt,
    tagsLength: () => tags.length,
    tags: (index: number) => tags[index],
  } as unknown as ParsedEvent;
}

test('ranks unique Nostr recommenders and ignores relay duplicates', () => {
  const events = [
    parsedEvent({
      id: 'old',
      kind: 38000,
      pubkey: 'alice',
      createdAt: 1,
      tags: [['d', 'mint-a'], ['k', '38172'], ['u', 'https://mint.example/']],
    }),
    parsedEvent({
      id: 'new',
      kind: 38000,
      pubkey: 'alice',
      createdAt: 2,
      tags: [['d', 'mint-a'], ['k', '38172'], ['u', 'https://mint.example']],
    }),
    parsedEvent({
      id: 'bob',
      kind: 38000,
      pubkey: 'bob',
      createdAt: 3,
      tags: [['d', 'mint-a'], ['k', '38172'], ['u', 'https://mint.example']],
    }),
    parsedEvent({
      id: 'carol',
      kind: 38000,
      pubkey: 'carol',
      createdAt: 4,
      tags: [['d', 'mint-b'], ['k', '38172'], ['u', 'https://other.example']],
    }),
  ];

  expect(rankCashuMintRecommendations(events)).toEqual([
    {mint: 'https://mint.example', recommendationCount: 2},
    {mint: 'https://other.example', recommendationCount: 1},
  ]);
});

test('publishes a transparent NIP-87 recommendation method', () => {
  const event = cashuMintRecommendationEvent({
    mint: 'https://mint.example',
    recommendationCount: 3,
  });

  expect(event.kind).toBe(38000);
  expect(event.content).toContain('3 unique Nostr recommendations');
  expect(event.tags).toEqual(
    expect.arrayContaining([
      ['k', '38172'],
      ['u', 'https://mint.example', 'cashu'],
      ['method', 'nostr-recommendation-count'],
    ]),
  );
});
