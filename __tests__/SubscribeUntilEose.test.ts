const mockUseSubscription = jest.fn();

jest.mock('@candypoets/nipworker/hooks', () => ({
  useSubscription: (...args: unknown[]) => mockUseSubscription(...args),
}));

import type {RequestObject, WorkerMessage} from '@candypoets/nipworker';
import {subscribeUntilEose} from '../src/nostr/subscribeUntilEose';

describe('subscribeUntilEose', () => {
  beforeEach(() => {
    mockUseSubscription.mockReset();
  });

  it('keeps the base id for a single finite request and forces EOSE closure', () => {
    const unsubscribe = jest.fn();
    const callback = jest.fn() as (message: WorkerMessage) => void;
    const request: RequestObject = {ids: ['event-id'], limit: 1, relays: []};
    mockUseSubscription.mockReturnValue(unsubscribe);

    const cleanup = subscribeUntilEose('event', [request], callback, {
      bytesPerEvent: 4096,
      closeOnEose: false,
    });

    expect(mockUseSubscription).toHaveBeenCalledWith(
      'event',
      [request],
      callback,
      {bytesPerEvent: 4096, closeOnEose: true},
    );

    cleanup();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('uses independent ids when a finite query contains multiple filters', () => {
    const cleanups = [jest.fn(), jest.fn()];
    const requests: RequestObject[] = [
      {kinds: [0], authors: ['author'], relays: []},
      {kinds: [10002], authors: ['author'], relays: []},
    ];
    mockUseSubscription
      .mockReturnValueOnce(cleanups[0])
      .mockReturnValueOnce(cleanups[1]);

    const cleanup = subscribeUntilEose('profile', requests, jest.fn());

    expect(mockUseSubscription.mock.calls).toEqual([
      ['profile:eose:0', [requests[0]], expect.any(Function), {closeOnEose: true}],
      ['profile:eose:1', [requests[1]], expect.any(Function), {closeOnEose: true}],
    ]);

    cleanup();
    expect(cleanups[0]).toHaveBeenCalledTimes(1);
    expect(cleanups[1]).toHaveBeenCalledTimes(1);
  });

  it('does not open a worker subscription for an empty snapshot', () => {
    const cleanup = subscribeUntilEose('empty', [], jest.fn());

    expect(mockUseSubscription).not.toHaveBeenCalled();
    expect(cleanup()).toBeUndefined();
  });
});
