import {nip19} from 'nostr-tools';

import type {RootStackParamList} from './types';

export type NostrDeepLinkRoute = {
  [K in keyof RootStackParamList]: {name: K; params: RootStackParamList[K]};
}[keyof RootStackParamList];

/**
 * Maps an invite link shared from the web app —
 * `https://nuts.cash/redeem?relay=<service-base-url>&token=<token>` or the
 * `nutsrn://redeem?…` custom-scheme variant — to the Redeem sheet.
 * Returns null for anything else. The token is opaque; it is passed through
 * untouched.
 */
export function resolveInviteDeepLink(
  rawPath: string,
): {name: 'Redeem'; params: RootStackParamList['Redeem']} | null {
  let url: URL;
  try {
    url = new URL(rawPath.trim());
  } catch {
    return null;
  }

  const isWebInvite =
    (url.protocol === 'https:' || url.protocol === 'http:') &&
    url.hostname === 'nuts.cash';
  const isSchemeInvite = url.protocol === 'nutsrn:';
  if (!isWebInvite && !isSchemeInvite) return null;

  // nutsrn://redeem?… puts 'redeem' in the host; nutsrn:///redeem and
  // https://nuts.cash/redeem put it in the path.
  const segment = (
    url.hostname === 'redeem'
      ? 'redeem'
      : url.pathname.replace(/^\/+|\/+$/g, '')
  ).toLowerCase();
  if (segment !== 'redeem') return null;

  const relay = url.searchParams.get('relay') || '';
  const token = url.searchParams.get('token') || '';
  if (!relay || !token) return null;

  return {name: 'Redeem', params: {relay, token}};
}

/**
 * Maps a NIP-19 / NIP-21 identifier (npub, nprofile, note, nevent, naddr —
 * optionally prefixed with `nostr:`) to a root stack route. Returns null for
 * anything that is not a decodable nostr identifier.
 */
export function resolveNostrDeepLink(
  rawPath: string,
): NostrDeepLinkRoute | null {
  let path = rawPath.trim();
  if (/^https?:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.hostname !== 'njump.me') return null;
      path = url.pathname;
    } catch {
      return null;
    }
  }
  path = path.replace(/^nostr:/i, '').replace(/^\/+/, '');
  if (!path) return null;

  const identifier = path.split(/[/?#]/)[0];
  if (!identifier) return null;

  try {
    const decoded = nip19.decode(identifier);
    switch (decoded.type) {
      case 'npub':
        return {name: 'PublicProfile', params: {pubkey: decoded.data}};
      case 'nprofile':
        return {
          name: 'PublicProfile',
          params: {pubkey: decoded.data.pubkey},
        };
      case 'nevent':
        return {name: 'Kind1Thread', params: {nevent: identifier}};
      case 'note':
        return {
          name: 'Kind1Thread',
          params: {nevent: nip19.neventEncode({id: decoded.data})},
        };
      case 'naddr':
        return {name: 'Kind30023Thread', params: {naddr: identifier}};
      default:
        return null;
    }
  } catch {
    return null;
  }
}
