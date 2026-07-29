/**
 * @format
 */

import {nip19} from 'nostr-tools';

import {resolveInviteDeepLink, resolveNostrDeepLink} from '../src/navigation/linking';

jest.mock('nostr-tools', () => ({
  nip19: jest.requireActual('nostr-tools/nip19'),
}));

const HEX_PUBKEY =
  '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const HEX_EVENT_ID =
  '1c54c71e9e6a1b8c5d0f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f';

const npub = nip19.npubEncode(HEX_PUBKEY);
const nprofile = nip19.nprofileEncode({pubkey: HEX_PUBKEY});
const note = nip19.noteEncode(HEX_EVENT_ID);
const nevent = nip19.neventEncode({id: HEX_EVENT_ID});
const naddr = nip19.naddrEncode({
  identifier: 'my-article',
  pubkey: HEX_PUBKEY,
  kind: 30023,
  relays: [],
});

describe('resolveNostrDeepLink', () => {
  it('routes npub to PublicProfile with hex pubkey', () => {
    expect(resolveNostrDeepLink(npub)).toEqual({
      name: 'PublicProfile',
      params: {pubkey: HEX_PUBKEY},
    });
  });

  it('routes nprofile to PublicProfile with hex pubkey', () => {
    expect(resolveNostrDeepLink(nprofile)).toEqual({
      name: 'PublicProfile',
      params: {pubkey: HEX_PUBKEY},
    });
  });

  it('routes nevent to Kind1Thread passing the identifier through', () => {
    expect(resolveNostrDeepLink(nevent)).toEqual({
      name: 'Kind1Thread',
      params: {nevent},
    });
  });

  it('converts note1 identifiers to nevent for Kind1Thread', () => {
    const route = resolveNostrDeepLink(note);
    expect(route?.name).toBe('Kind1Thread');
    expect(
      (route?.params as {nevent: string} | undefined)?.nevent,
    ).toMatch(/^nevent1/);
  });

  it('routes naddr to Kind30023Thread', () => {
    expect(resolveNostrDeepLink(naddr)).toEqual({
      name: 'Kind30023Thread',
      params: {naddr},
    });
  });

  it('strips the nostr: NIP-21 prefix', () => {
    expect(resolveNostrDeepLink(`nostr:${npub}`)).toEqual({
      name: 'PublicProfile',
      params: {pubkey: HEX_PUBKEY},
    });
  });

  it('ignores njump-style path and query suffixes', () => {
    expect(resolveNostrDeepLink(`/${nevent}?foo=bar`)).toEqual({
      name: 'Kind1Thread',
      params: {nevent},
    });
    expect(resolveNostrDeepLink(`https://njump.me/${nevent}?foo=bar`)).toEqual({
      name: 'Kind1Thread',
      params: {nevent},
    });
  });

  it('returns null for non-nostr input', () => {
    expect(resolveNostrDeepLink('')).toBeNull();
    expect(resolveNostrDeepLink('hello world')).toBeNull();
    expect(resolveNostrDeepLink('nsec1invalid')).toBeNull();
    expect(
      resolveNostrDeepLink('https://example.com/some/page'),
    ).toBeNull();
  });
});

describe('resolveInviteDeepLink', () => {
  const relay = 'https://community.example.com';
  const token = 'eyJ2IjoxfQ.c2ln';
  const query = `relay=${encodeURIComponent(relay)}&token=${encodeURIComponent(
    token,
  )}`;

  it('routes https://nuts.cash/redeem links to Redeem with decoded params', () => {
    expect(resolveInviteDeepLink(`https://nuts.cash/redeem?${query}`)).toEqual({
      name: 'Redeem',
      params: {relay, token},
    });
  });

  it('accepts a trailing slash on the path', () => {
    expect(resolveInviteDeepLink(`https://nuts.cash/redeem/?${query}`)).toEqual(
      {name: 'Redeem', params: {relay, token}},
    );
  });

  it('routes the nutsrn://redeem custom-scheme variant', () => {
    expect(resolveInviteDeepLink(`nutsrn://redeem?${query}`)).toEqual({
      name: 'Redeem',
      params: {relay, token},
    });
    expect(resolveInviteDeepLink(`nutsrn:///redeem?${query}`)).toEqual({
      name: 'Redeem',
      params: {relay, token},
    });
  });

  it('returns null when relay or token is missing', () => {
    expect(
      resolveInviteDeepLink(
        `https://nuts.cash/redeem?relay=${encodeURIComponent(relay)}`,
      ),
    ).toBeNull();
    expect(
      resolveInviteDeepLink(`https://nuts.cash/redeem?token=${token}`),
    ).toBeNull();
  });

  it('returns null for other hosts and paths', () => {
    expect(resolveInviteDeepLink(`https://example.com/redeem?${query}`)).toBeNull();
    expect(resolveInviteDeepLink('https://nuts.cash/explore')).toBeNull();
    expect(resolveInviteDeepLink(`https://njump.me/redeem?${query}`)).toBeNull();
    expect(resolveInviteDeepLink('hello world')).toBeNull();
    expect(resolveInviteDeepLink('')).toBeNull();
  });
});
