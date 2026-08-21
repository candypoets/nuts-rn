import {
  buildRelayListPublishPlan,
  buildRelayMarkers,
  buildRelayListTags,
  uniqueRelays,
} from '../src/nostr/relayList';

describe('NIP-65 relay lists', () => {
  it('normalizes relay URLs and encodes read/write markers', () => {
    expect(
      buildRelayMarkers(
        [' wss://inbox.example/ ', 'wss://both.example'],
        ['wss://outbox.example/', 'wss://both.example'],
      ),
    ).toEqual([
      {url: 'wss://both.example', read: true, write: true},
      {url: 'wss://inbox.example', read: true, write: false},
      {url: 'wss://outbox.example', read: false, write: true},
    ]);
    expect(
      buildRelayListTags(
        ['wss://inbox.example', 'wss://both.example'],
        ['wss://outbox.example', 'wss://both.example'],
      ),
    ).toEqual([
      ['r', 'wss://both.example'],
      ['r', 'wss://inbox.example', 'read'],
      ['r', 'wss://outbox.example', 'write'],
    ]);
  });

  it('builds the initial signup list as both inbox and outbox', () => {
    const accountRelays = [
      'wss://relay.damus.io',
      'wss://nos.lol/',
      'wss://relay.nuts.cash',
    ];
    const plan = buildRelayListPublishPlan({
      readRelays: accountRelays,
      writeRelays: accountRelays,
      discoveryRelays: ['wss://purplepag.es', 'wss://nos.lol'],
      createdAt: 123,
    });

    expect(plan.event).toEqual({
      kind: 10002,
      created_at: 123,
      content: '',
      tags: [
        ['r', 'wss://nos.lol'],
        ['r', 'wss://relay.damus.io'],
        ['r', 'wss://relay.nuts.cash'],
      ],
    });
    expect(plan.markers.every(relay => relay.read && relay.write)).toBe(true);
    expect(plan.publishRelays).toEqual([
      'wss://relay.damus.io',
      'wss://nos.lol',
      'wss://relay.nuts.cash',
      'wss://purplepag.es',
    ]);
    expect(uniqueRelays(plan.publishRelays)).toEqual(plan.publishRelays);
  });
});
