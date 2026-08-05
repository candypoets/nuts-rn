import type {ParsedEvent} from '@candypoets/nipworker';

import {eventTags} from '../components/notes/kindHelpers';
import {DEFAULT_COMMUNITY_TYPE, isCommunityType, type CommunityType} from './communityTypes';

/** NIP-97 protocol constants. The draft of record lives at ~/nips/97.md. */
export const COMMUNITY_ANCHOR_KIND = 31727;
export const COMMUNITY_ANCHOR_D = 'community';
export const ROLE_MEMBERSHIP_KIND = 30009;
export const CLASSIFIED_LISTING_KIND = 30402;
export const DEFINITION_KINDS = [
  ROLE_MEMBERSHIP_KIND,
  CLASSIFIED_LISTING_KIND,
  31922,
  31923,
] as const;
export const FULFILLMENT_KIND = 37237;

export type CommunityAnchor = {
  id: string;
  pubkey: string;
  admins: string[];
  badgeIssuer?: string;
  name: string;
  description: string;
  image: string;
  /** Nuts display extension; authority never depends on this value. */
  type: CommunityType;
  createdAt: number;
};

function validPubkey(value: unknown) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : undefined;
}

function httpUrl(value: string | undefined) {
  return value && /^https?:\/\//.test(value) ? value : '';
}

/** Parse a root-authored anchor after the caller has pinned its author to NIP-11. */
export function parseCommunityAnchor(event: ParsedEvent): CommunityAnchor | undefined {
  if (event.kind() !== COMMUNITY_ANCHOR_KIND) return undefined;
  const tags = eventTags(event);
  if (tags.find(tag => tag[0] === 'd')?.[1] !== COMMUNITY_ANCHOR_D) {
    return undefined;
  }
  const pubkey = validPubkey(event.pubkey());
  const id = event.id();
  if (!pubkey || !id) return undefined;

  const admins = Array.from(
    new Set(
      tags
        .filter(tag => tag[0] === 'p')
        .map(tag => validPubkey(tag[1]))
        .filter((admin): admin is string => Boolean(admin)),
    ),
  );
  if (!admins.length) return undefined;

  const typeValue = tags.find(tag => tag[0] === 'type')?.[1];
  return {
    id,
    pubkey,
    admins,
    badgeIssuer: validPubkey(tags.find(tag => tag[0] === 'badge_issuer')?.[1]),
    name: tags.find(tag => tag[0] === 'name')?.[1] || '',
    description: tags.find(tag => tag[0] === 'description')?.[1] || '',
    image: httpUrl(tags.find(tag => tag[0] === 'image')?.[1]),
    type: isCommunityType(typeValue) ? typeValue : DEFAULT_COMMUNITY_TYPE,
    createdAt: Number(event.createdAt()),
  };
}

export function isNewerCommunityAnchor(candidate: CommunityAnchor, current: CommunityAnchor) {
  return (
    candidate.createdAt > current.createdAt ||
    (candidate.createdAt === current.createdAt && candidate.id < current.id)
  );
}

export type PermissionAccess = 'read' | 'write';

export type Permission = {
  capability: string;
  access?: PermissionAccess;
  topic?: string;
};

export function parsePermissionTag(tag: string[]): Permission | undefined {
  if (tag[0] !== 'permission' || !tag[1]) return undefined;
  const marker = tag[2];
  return {
    capability: tag[1],
    access: marker === 'read' || marker === 'write' ? marker : undefined,
    topic: tag[3] || undefined,
  };
}

export function permissionGrants(
  permission: Permission,
  kind: number,
  access: PermissionAccess,
  topic?: string,
) {
  if (!/^\d+$/.test(permission.capability)) return false;
  if (Number(permission.capability) !== kind) return false;
  if (permission.access && permission.access !== access) return false;
  return !permission.topic || permission.topic === topic;
}

export function definitionAddress(kind: number, pubkey: string, d: string) {
  return `${kind}:${pubkey}:${d}`;
}

export function parseDefinitionAddress(address: string) {
  const [kindValue, pubkey, ...identifierParts] = address.split(':');
  const kind = Number(kindValue);
  const d = identifierParts.join(':');
  if (!(DEFINITION_KINDS as readonly number[]).includes(kind) || !validPubkey(pubkey) || !d) {
    return undefined;
  }
  return {kind, pubkey: pubkey.toLowerCase(), d};
}
