import type {ParsedEvent} from '@candypoets/nipworker';

import {eventTags} from '../components/notes/kindHelpers';
import {
  DEFAULT_COMMUNITY_TYPE,
  isCommunityType,
  type CommunityType,
} from './communityTypes';

/**
 * Community profile: an addressable app-data event (NIP-78, kind 30078) published
 * by an admin to the community relay only. The community archetype lives here and
 * selects the store preset. Ported from nuts-cash src/lib/communityProfile.ts.
 */
export const COMMUNITY_PROFILE_KIND = 30078;
export const COMMUNITY_PROFILE_D = 'nuts-community-profile';

export type CommunityProfile = {
  pubkey: string;
  type: CommunityType;
  description: string;
  image: string;
  createdAt: number;
};

function httpUrl(value: string | undefined) {
  return value && /^https?:\/\//.test(value) ? value : '';
}

export function parseCommunityProfile(
  event: ParsedEvent,
): CommunityProfile | undefined {
  if (event.kind() !== COMMUNITY_PROFILE_KIND) return undefined;
  const tags = eventTags(event);
  const d = tags.find(tag => tag[0] === 'd')?.[1];
  if (d !== COMMUNITY_PROFILE_D) return undefined;
  const pubkey = event.pubkey();
  if (!pubkey) return undefined;

  const typeValue = tags.find(tag => tag[0] === 'type')?.[1];
  return {
    pubkey,
    type: isCommunityType(typeValue) ? typeValue : DEFAULT_COMMUNITY_TYPE,
    description: tags.find(tag => tag[0] === 'description')?.[1] || '',
    image: httpUrl(tags.find(tag => tag[0] === 'image')?.[1]),
    createdAt: Number(event.createdAt()),
  };
}
