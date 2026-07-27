import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {HomeFeed} from '../src/feeds/HomeFeed';

let mockLatestFeedProps: Record<string, unknown> | null = null;
const mockSubscribe = jest.fn(() => jest.fn());
const mockSetRelayStatus = jest.fn();

const mockAuthState = {
  pubkey: 'test-pubkey',
  hasSigner: true,
};
const mockNostrState = {
  readRelays: [],
  walletReadRelays: [],
  kind10019UpdatedAt: 1,
  mutedPubkeys: [],
  mutedHashtags: [],
  mutedWords: [],
  mutedEventIds: [],
};
const mockWalletState = {
  walletMintUrls: [],
  activeMintUrl: null,
  balanceByMint: {},
  setActiveMintUrl: jest.fn(),
  initializeProofWallet: jest.fn(() => Promise.resolve()),
  clearProofStorageOnce: jest.fn(() => Promise.resolve()),
  addProofs: jest.fn(() => Promise.resolve()),
  checkAndFilterProofs: jest.fn(() => Promise.resolve([])),
  verifyAndCleanProofs: jest.fn(() => Promise.resolve()),
};

jest.mock('../src/components/Feed', () => {
  const ReactModule = require('react');
  return {
    Feed: (props: Record<string, unknown>) => {
      mockLatestFeedProps = props;
      return ReactModule.createElement('FeedMock');
    },
  };
});

jest.mock('../src/stores', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
  useNostrStore: (selector: (state: typeof mockNostrState) => unknown) =>
    selector(mockNostrState),
  useRelayStore: (
    selector: (state: {setRelayStatus: typeof mockSetRelayStatus}) => unknown,
  ) => selector({setRelayStatus: mockSetRelayStatus}),
  useWalletStore: (selector: (state: typeof mockWalletState) => unknown) =>
    selector(mockWalletState),
}));

jest.mock('@candypoets/nipworker/hooks', () => ({
  useSubscription: () => mockSubscribe(),
}));

jest.mock('../src/hooks/useWalletSubscription', () => ({
  uniqueWalletRelays: () => [],
}));

function getFeedProps() {
  expect(mockLatestFeedProps).not.toBeNull();
  return mockLatestFeedProps!;
}

describe('HomeFeed pull to refresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLatestFeedProps = null;
    mockSubscribe.mockReset();
    mockSubscribe.mockImplementation(() => jest.fn());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops refreshing after three seconds when relays never resolve', () => {
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<HomeFeed enabled visible />);
    });

    act(() => {
      (getFeedProps().onRefresh as () => void)();
    });
    expect(getFeedProps().refreshing).toBe(true);

    act(() => {
      jest.advanceTimersByTime(2_999);
    });
    expect(getFeedProps().refreshing).toBe(true);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(getFeedProps().refreshing).toBe(false);

    act(() => renderer!.unmount());
  });

  it('stops refreshing immediately when subscription startup fails', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(<HomeFeed enabled visible />);
    });
    mockSubscribe.mockImplementationOnce(() => {
      throw new Error('subscription failed');
    });

    act(() => {
      (getFeedProps().onRefresh as () => void)();
    });

    expect(getFeedProps().refreshing).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      '[home-refresh] initialization failed',
      expect.any(Error),
    );

    warn.mockRestore();
    act(() => renderer!.unmount());
  });
});
