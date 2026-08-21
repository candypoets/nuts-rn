jest.mock('../src/nostr/upload', () => ({
  base64UrlEncode: jest.fn(() => 'signed-auth'),
  canonicalAuthEvent: jest.fn(event => event),
  signEvent: jest.fn(async () => ({
    id: 'id',
    pubkey: 'pubkey',
    created_at: 1,
    kind: 27235,
    tags: [],
    content: '',
    sig: 'sig',
  })),
}));

import { decode } from 'nostr-tools/nip19';

import { pushNotificationRoute } from '../src/notifications/pushNavigation';
import {
  normalizePushRelays,
  registerPushDevice,
  unregisterPushDevice,
  unregisterPushDeviceForLogout,
} from '../src/notifications/pushRegistration';

const mockSignEvent = jest.requireMock('../src/nostr/upload')
  .signEvent as jest.Mock;

describe('push notifications', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    mockSignEvent.mockResolvedValue({
      id: 'id',
      pubkey: 'pubkey',
      created_at: 1,
      kind: 27235,
      tags: [],
      content: '',
      sig: 'sig',
    });
    globalThis.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as jest.Mock;
  });

  it('normalizes, sorts, and deduplicates relay registrations', () => {
    expect(
      normalizePushRelays([
        ' wss://two.example/ ',
        'invalid',
        'wss://one.example',
        'wss://two.example',
      ]),
    ).toEqual(['wss://one.example', 'wss://two.example']);
  });

  it('registers the complete relay set with NIP-98 authorization', async () => {
    await registerPushDevice('fcm', 'native-device-token', [
      'wss://two.example/',
      'wss://one.example',
    ]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://push.nuts.cash/push/register',
      expect.objectContaining({
        method: 'POST',
        headers: {
          authorization: 'Nostr signed-auth',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          platform: 'fcm',
          token: 'native-device-token',
          relays: ['wss://one.example', 'wss://two.example'],
        }),
      }),
    );
  });

  it('unregisters the device token', async () => {
    await unregisterPushDevice('native-device-token');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://push.nuts.cash/push/unregister',
      expect.objectContaining({
        body: JSON.stringify({ token: 'native-device-token' }),
      }),
    );
  });

  it('stops waiting when a remote signer never authorizes logout unregister', async () => {
    jest.useFakeTimers();
    mockSignEvent.mockImplementationOnce(() => new Promise(() => {}));

    const unregister = unregisterPushDeviceForLogout('native-device-token', 25);
    const settled = unregister.then(
      () => null,
      error => error,
    );
    await jest.advanceTimersByTimeAsync(25);

    await expect(settled).resolves.toThrow('Push unregister timed out');
  });

  it('opens the referenced thread with the source relay', () => {
    const target = '11'.repeat(32);
    const route = pushNotificationRoute({
      event_id: '22'.repeat(32),
      target_event_id: target,
      event_kind: 7,
      source_relay: 'wss://relay.example',
    });

    expect(route.pathname).toBe('/Kind1Thread');
    if (route.pathname !== '/Kind1Thread') throw new Error('wrong route');
    expect(decode(route.params.nevent)).toEqual({
      type: 'nevent',
      data: {
        id: target,
        relays: ['wss://relay.example'],
      },
    });
  });

  it('falls back to the notifications screen for malformed payloads', () => {
    expect(pushNotificationRoute({ event_id: 'bad' })).toEqual({
      pathname: '/Notifications',
    });
  });
});
