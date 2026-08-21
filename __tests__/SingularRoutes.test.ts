import { nip19 } from 'nostr-tools';

import {
  singularByParams,
  singularNostrRoute,
} from '../src/navigation/singularRoutes';

jest.mock('nostr-tools', () => ({
  nip19: jest.requireActual('nostr-tools/nip19'),
}));

describe('singular route identities', () => {
  it('uses only the params that identify a screen', () => {
    const communityIdentity = singularByParams('relay');

    expect(
      communityIdentity('Community', {
        relay: 'wss://community.example',
        name: 'Old name',
      }),
    ).toBe(
      communityIdentity('Community', {
        relay: 'wss://community.example',
        name: 'New name',
      }),
    );
    expect(
      communityIdentity('Community', { relay: 'wss://other.example' }),
    ).not.toBe(
      communityIdentity('Community', { relay: 'wss://community.example' }),
    );
  });

  it('treats differently hinted nevents as the same note', () => {
    const id = '11'.repeat(32);
    const first = nip19.neventEncode({
      id,
      relays: ['wss://one.example'],
    });
    const second = nip19.neventEncode({
      id,
      relays: ['wss://two.example'],
      author: '22'.repeat(32),
    });

    expect(singularNostrRoute('Kind1Thread', { nevent: first })).toBe(
      singularNostrRoute('Kind1Thread', { nevent: second }),
    );
  });

  it('keeps different notes as different stack entries', () => {
    const first = nip19.neventEncode({ id: '11'.repeat(32) });
    const second = nip19.neventEncode({ id: '22'.repeat(32) });

    expect(singularNostrRoute('Kind1Thread', { nevent: first })).not.toBe(
      singularNostrRoute('Kind1Thread', { nevent: second }),
    );
  });

  it('canonicalizes naddr relay hints without merging different articles', () => {
    const address = {
      kind: 30023,
      pubkey: '33'.repeat(32),
      identifier: 'hello',
    };
    const first = nip19.naddrEncode({
      ...address,
      relays: ['wss://one.example'],
    });
    const second = nip19.naddrEncode({
      ...address,
      relays: ['wss://two.example'],
    });
    const other = nip19.naddrEncode({ ...address, identifier: 'goodbye' });

    expect(singularNostrRoute('Kind30023Thread', { naddr: first })).toBe(
      singularNostrRoute('Kind30023Thread', { naddr: second }),
    );
    expect(singularNostrRoute('Kind30023Thread', { naddr: first })).not.toBe(
      singularNostrRoute('Kind30023Thread', { naddr: other }),
    );
  });
});
