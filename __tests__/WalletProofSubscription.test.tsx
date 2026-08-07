import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';

import {useWalletProofSubscription} from '../src/hooks/useWalletProofSubscription';

const mockSubscribe = jest.fn((..._args: unknown[]) => jest.fn());
const mockInitializeProofWallet = jest.fn(() => Promise.resolve());
const mockClearProofStorageOnce = jest.fn(() => Promise.resolve());
const mockVerifyAndCleanProofs = jest.fn(() => Promise.resolve());

const mockAuthState = {pubkey: 'test-pubkey'};
const mockNostrState = {
  readRelays: [],
  walletReadRelays: [],
  kind10019UpdatedAt: 0,
  mutedPubkeys: [],
  mutedHashtags: [],
  mutedWords: [],
  mutedEventIds: [],
};
const mockWalletState = {
  walletMintUrls: ['https://mint.example'],
  initializeProofWallet: mockInitializeProofWallet,
  clearProofStorageOnce: mockClearProofStorageOnce,
  addProofs: jest.fn(() => Promise.resolve()),
  checkAndFilterProofs: jest.fn((_: string, proofs: unknown[]) =>
    Promise.resolve(proofs),
  ),
  verifyAndCleanProofs: mockVerifyAndCleanProofs,
};

jest.mock('../src/stores', () => ({
  useAuthStore: (selector: (state: typeof mockAuthState) => unknown) =>
    selector(mockAuthState),
  useNostrStore: (selector: (state: typeof mockNostrState) => unknown) =>
    selector(mockNostrState),
  useWalletStore: (selector: (state: typeof mockWalletState) => unknown) =>
    selector(mockWalletState),
}));

jest.mock('@candypoets/nipworker/hooks', () => ({
  useSubscription: (...args: unknown[]) => mockSubscribe(...args),
}));

jest.mock('../src/hooks/useWalletSubscription', () => ({
  uniqueWalletRelays: () => ['wss://relay.nuts.cash'],
}));

function WalletProofHarness() {
  useWalletProofSubscription({enabled: true});
  return null;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('app-level wallet proof loading', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockSubscribe.mockImplementation((..._args: unknown[]) => jest.fn());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('loads local balance immediately and recovers relay proofs without Home', async () => {
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = ReactTestRenderer.create(<WalletProofHarness />);
      await flushPromises();
    });

    expect(mockClearProofStorageOnce).toHaveBeenCalledWith('test-pubkey');
    expect(mockInitializeProofWallet).toHaveBeenCalledWith('test-pubkey', [
      'https://mint.example',
    ]);
    expect(mockSubscribe).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1_000);
      await flushPromises();
    });

    expect(mockSubscribe).toHaveBeenCalledWith(
      'app_wallet_proofs_test-pubkey',
      [
        expect.objectContaining({
          kinds: [7375],
          authors: ['test-pubkey'],
          relays: ['wss://relay.nuts.cash'],
        }),
      ],
      expect.any(Function),
      expect.objectContaining({isSlow: true}),
    );

    act(() => renderer.unmount());
  });
});
