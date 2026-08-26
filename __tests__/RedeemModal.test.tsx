import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { router } from 'expo-router';

import { RedeemModal } from '../src/modals/RedeemModal';

const mockCheckExistingMembership = jest.fn();
const mockRedeemInvite = jest.fn();
let mockAuth: { pubkey: string | null; hasSigner: boolean } = {
  pubkey: 'member-pubkey',
  hasSigner: true,
};

jest.mock('expo-image', () => {
  const ReactModule = require('react');
  const { View: MockView } = require('react-native');
  return {
    Image: (props: Record<string, unknown>) =>
      ReactModule.createElement(MockView, props),
  };
});

jest.mock('../src/nostr/invites', () => ({
  checkExistingMembership: (...args: unknown[]) =>
    mockCheckExistingMembership(...args),
  communityNameFromRelay: () => 'Fallback community',
  fetchCommunityInfo: () =>
    Promise.resolve({
      name: 'The Office',
      image: 'https://example.test/icon.png',
    }),
  normalizeRelayBaseUrl: (value: string) => value,
  redeemInvite: (...args: unknown[]) => mockRedeemInvite(...args),
  relayUrlFromBaseUrl: () => 'wss://office.example',
}));

jest.mock('../src/nostr/manager', () => ({
  getSharedNostrManager: () => ({}),
}));

jest.mock('../src/stores', () => ({
  useAuthStore: (selector: (state: typeof mockAuth) => unknown) =>
    selector(mockAuth),
}));

jest.mock('../src/theme', () => ({
  useAppTheme: () => ({
    colors: {
      base100: '#111111',
      base200: '#242424',
      primary: '#1fb092',
      primaryContent: '#b8c0c0',
      error: '#ef4444',
    },
    button: { primary: { text: '#071c17' } },
  }),
}));

jest.mock('../src/modals/ProfileModal', () => {
  const ReactModule = require('react');
  const { View: MockView } = require('react-native');
  return {
    PrivateKeyLogin: () =>
      ReactModule.createElement(MockView, { testID: 'invite-login' }),
  };
});

jest.mock('../src/modals/SignupModal', () => {
  const ReactModule = require('react');
  const { View: MockView } = require('react-native');
  return {
    SignupProfileStep: () =>
      ReactModule.createElement(MockView, { testID: 'invite-signup' }),
    useSignupProfileController: () => ({
      avatar: null,
      bio: '',
      canContinue: false,
      continueFromProfile: jest.fn(),
      name: '',
      pickAvatar: jest.fn(),
      setBio: jest.fn(),
      setName: jest.fn(),
      status: null,
    }),
  };
});

function buttonWithLabel(
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string,
) {
  return renderer.root.findAll(
    node => node.props.accessibilityLabel === label && node.props.onPress,
  )[0];
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { pubkey: 'member-pubkey', hasSigner: true };
  mockCheckExistingMembership.mockResolvedValue(false);
  mockRedeemInvite.mockResolvedValue({
    communityRelayUrl: 'wss://office.example',
  });
});

test('replaces the invite modal with Community immediately after redemption', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <RedeemModal
        relay="https://office.example"
        token="invite-token"
        onDone={jest.fn()}
      />,
    );
  });
  await flushEffects();

  const claim = buttonWithLabel(renderer!, 'Claim invite');
  expect(claim).toBeDefined();
  await act(async () => {
    await claim!.props.onPress();
  });

  expect(mockRedeemInvite).toHaveBeenCalledWith(
    expect.objectContaining({
      pubkey: 'member-pubkey',
      relayBaseUrl: 'https://office.example',
      token: 'invite-token',
    }),
  );
  expect(router.replace).toHaveBeenCalledWith({
    pathname: '/Community',
    params: {
      icon: 'https://example.test/icon.png',
      name: 'The Office',
      relationship: 'belong',
      relay: 'wss://office.example',
    },
  });
});

test('sends an existing member directly to Community', async () => {
  mockCheckExistingMembership.mockResolvedValue(true);

  act(() => {
    ReactTestRenderer.create(
      <RedeemModal
        relay="https://office.example"
        token="invite-token"
        onDone={jest.fn()}
      />,
    );
  });
  await flushEffects();

  expect(mockRedeemInvite).not.toHaveBeenCalled();
  expect(router.replace).toHaveBeenCalledWith(
    expect.objectContaining({ pathname: '/Community' }),
  );
});

test('resumes post-redemption work after the award was granted', async () => {
  mockRedeemInvite
    .mockRejectedValueOnce(new Error('Could not save membership indexes.'))
    .mockResolvedValueOnce({ communityRelayUrl: 'wss://office.example' });

  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <RedeemModal
        relay="https://office.example"
        token="invite-token"
        onDone={jest.fn()}
      />,
    );
  });
  await flushEffects();

  await act(async () => {
    await buttonWithLabel(renderer!, 'Claim invite').props.onPress();
  });
  expect(buttonWithLabel(renderer!, 'Retry invitation')).toBeDefined();

  mockCheckExistingMembership.mockResolvedValue(true);
  await act(async () => {
    await buttonWithLabel(renderer!, 'Retry invitation').props.onPress();
  });

  expect(mockRedeemInvite).toHaveBeenLastCalledWith(
    expect.objectContaining({ membershipAlreadyGranted: true }),
  );
  expect(router.replace).toHaveBeenCalledWith(
    expect.objectContaining({ pathname: '/Community' }),
  );
});

test('opens profile creation inside the invite route for a new user', async () => {
  mockAuth = { pubkey: null, hasSigner: false };
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <RedeemModal
        relay="https://office.example"
        token="invite-token"
        onDone={jest.fn()}
      />,
    );
  });
  await flushEffects();

  const createProfile = buttonWithLabel(
    renderer!,
    'Create profile and join community',
  );
  expect(createProfile).toBeDefined();
  act(() => createProfile!.props.onPress());

  expect(renderer!.root.findByProps({ testID: 'invite-signup' })).toBeTruthy();
  expect(router.push).not.toHaveBeenCalled();
});
