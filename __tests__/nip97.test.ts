import type {ParsedEvent} from '@candypoets/nipworker';

import {
  buildCatalogDefinitionTags,
  catalogAddress,
  catalogMaxUses,
  catalogName,
  catalogType,
  isCatalogDefinition,
} from '../src/lib/catalog';
import {awardSignerAuthorized} from '../src/lib/communityTrust';
import {parseCommunityAnchor, parsePermissionTag, permissionGrants} from '../src/lib/nip97';

const ROOT = '11'.repeat(32);
const ADMIN = '22'.repeat(32);
const ISSUER = '33'.repeat(32);

function parsedEvent(input: {
  id?: string;
  kind: number;
  pubkey?: string;
  createdAt?: number;
  tags: string[][];
}): ParsedEvent {
  const tags = input.tags.map(items => ({
    itemsLength: () => items.length,
    items: (index: number) => items[index],
  }));
  return {
    id: () => input.id || 'aa'.repeat(32),
    kind: () => input.kind,
    pubkey: () => input.pubkey || ROOT,
    createdAt: () => input.createdAt || 1,
    tagsLength: () => tags.length,
    tags: (index: number) => tags[index],
  } as unknown as ParsedEvent;
}

test('parses the root-authored NIP-97 community anchor', () => {
  const anchor = parseCommunityAnchor(
    parsedEvent({
      kind: 31727,
      tags: [
        ['d', 'community'],
        ['p', ADMIN],
        ['badge_issuer', ISSUER],
        ['name', 'The Gym'],
        ['type', 'sports'],
      ],
    }),
  );

  expect(anchor).toMatchObject({
    pubkey: ROOT,
    admins: [ADMIN],
    badgeIssuer: ISSUER,
    name: 'The Gym',
    type: 'sports',
  });
});

test('kind-scoped permissions grant only the requested access and topic', () => {
  const permission = parsePermissionTag(['permission', '30009', 'write', 'membership']);
  expect(permission).toBeDefined();
  expect(permissionGrants(permission!, 30009, 'write', 'membership')).toBe(true);
  expect(permissionGrants(permission!, 30009, 'read', 'membership')).toBe(false);
  expect(permissionGrants(permission!, 30009, 'write', 'role')).toBe(false);
});

test('NIP-99 products use kind 30402 standard tags and default to one use', () => {
  const tags = buildCatalogDefinitionTags({
    d: 'coffee',
    type: 'product',
    name: 'Coffee',
    price: '3.50',
    currency: 'EUR',
    productKind: 'drink',
  });
  const event = parsedEvent({kind: 30402, pubkey: ADMIN, tags});

  expect(tags).toContainEqual(['t', 'product']);
  expect(tags).toContainEqual(['title', 'Coffee']);
  expect(tags).toContainEqual(['status', 'active']);
  expect(catalogType(event)).toBe('product');
  expect(catalogName(event)).toBe('Coffee');
  expect(catalogAddress(event)).toBe(`30402:${ADMIN}:coffee`);
  expect(catalogMaxUses(event)).toBe(1);
  expect(isCatalogDefinition(event)).toBe(true);
});

test('sellable memberships remain kind 30009 and are unlimited by default', () => {
  const tags = buildCatalogDefinitionTags({
    d: 'monthly',
    type: 'membership',
    name: 'Monthly member',
    price: '15',
    currency: 'EUR',
    billing: 'monthly',
  });
  const event = parsedEvent({kind: 30009, pubkey: ADMIN, tags});

  expect(tags).toContainEqual(['t', 'membership']);
  expect(tags).toContainEqual(['name', 'Monthly member']);
  expect(catalogType(event)).toBe('membership');
  expect(catalogAddress(event)).toBe(`30009:${ADMIN}:monthly`);
  expect(catalogMaxUses(event)).toBeUndefined();
  expect(isCatalogDefinition(event)).toBe(true);
});

test('delegated issuer may award only priced definitions', () => {
  const trust = {
    rootPubkey: ROOT,
    authorityPubkeys: new Set([ADMIN]),
    badgeIssuer: ISSUER,
  };
  const delegatedAward = parsedEvent({
    kind: 8,
    pubkey: ISSUER,
    tags: [['p', ROOT]],
  });
  const priced = parsedEvent({
    kind: 30402,
    pubkey: ADMIN,
    tags: [['price', '5', 'EUR']],
  });
  const unpriced = parsedEvent({kind: 30009, pubkey: ADMIN, tags: []});
  const adminAward = parsedEvent({kind: 8, pubkey: ADMIN, tags: [['p', ROOT]]});

  expect(awardSignerAuthorized(delegatedAward, priced, trust)).toBe(true);
  expect(awardSignerAuthorized(delegatedAward, unpriced, trust)).toBe(false);
  expect(awardSignerAuthorized(adminAward, unpriced, trust)).toBe(true);
});
