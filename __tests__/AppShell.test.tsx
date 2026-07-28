/**
 * App-shell smoke test for the expo-router entry.
 *
 * The pre-migration App.test rendered App.tsx — a React Navigation container
 * hosting the tab/stack navigators and the initial feed. The entry point is
 * now expo-router/entry and the shell is app/_layout.tsx. renderRouter()
 * cannot be used here (@testing-library/react-native is not installed), so
 * this mounts the root layout directly under the standard module mocks and
 * asserts the provider tree, the root Stack with its (tabs) screen and the
 * named presentation/animation entries, the RootServices auth wiring, and the
 * / -> /ExploreTab redirect.
 */

import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {StatusBar} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Redirect, Stack} from 'expo-router';

const mockManager = {
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  cleanup: jest.fn(),
};

jest.mock('../src/nostr/manager', () => ({
  getSharedNostrManager: () => mockManager,
}));

// The real nipworker hooks need a global native manager; subscriptions are
// no-ops here (same pattern as HomeFeedRefresh.test.tsx).
jest.mock('@candypoets/nipworker/hooks', () => ({
  useSubscription: () => jest.fn(),
  useRelayStatus: () => jest.fn(),
}));

import RootLayout from '../app/_layout';
import Index from '../app/index';

beforeEach(() => {
  jest.clearAllMocks();
});

test('root layout mounts the provider tree, root stack and overlays', async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(() => {
    renderer = ReactTestRenderer.create(<RootLayout />);
  });

  expect(renderer.root.findByType(GestureHandlerRootView)).toBeTruthy();
  expect(renderer.root.findByType(SafeAreaProvider)).toBeTruthy();
  expect(renderer.root.findByType(StatusBar)).toBeTruthy();

  const stack = renderer.root.findByType(Stack);
  expect(stack.props.screenOptions).toMatchObject({
    freezeOnBlur: true,
    headerShown: false,
  });
  const screens = renderer.root.findAllByType(Stack.Screen);
  const optionsByName = Object.fromEntries(
    screens.map(screen => [screen.props.name, screen.props.options]),
  );
  // (tabs) is the only screen that opts out of freezeOnBlur.
  expect(optionsByName['(tabs)']).toEqual({freezeOnBlur: false});
  // presentation/animation are read at push time, so they must be declared
  // on the root Stack — in-route <Stack.Screen options> lands too late.
  expect(optionsByName.PublicProfile).toEqual({animation: 'simple_push'});
  expect(optionsByName.Wallet).toEqual({presentation: 'modal'});
  expect(optionsByName.Kind1111Comments).toEqual({
    presentation: 'formSheet',
    sheetAllowedDetents: [0.66, 0.92],
    sheetExpandsWhenScrolledToEdge: false,
    sheetGrabberVisible: true,
    sheetInitialDetentIndex: 0,
  });
  expect(optionsByName.Post).toEqual({
    presentation: 'fullScreenModal',
    gestureEnabled: false,
  });
  expect(Object.keys(optionsByName).sort()).toEqual(
    [
      '(tabs)',
      'CalendarEvent',
      'ChatThread',
      'CmdK',
      'Community',
      'FeedBuilder',
      'Keys',
      'Kind1111Comments',
      'Kind1Thread',
      'Kind30023Thread',
      'Lightning',
      'LiveStream',
      'Login',
      'Logout',
      'Minting',
      'Mints',
      'NewChat',
      'Notifications',
      'Post',
      'Profile',
      'ProfileStub',
      'PublicProfile',
      'Receive',
      'RelayInfos',
      'RelayPreferences',
      'Scan',
      'Send',
      'SendEcash',
      'Share',
      'Tags',
      'Tapcash',
      'Theme',
      'Wallet',
    ].sort(),
  );

  // RootServices wires the nostr manager auth event to the auth store.
  expect(mockManager.addEventListener).toHaveBeenCalledWith(
    'auth',
    expect.any(Function),
  );

  await act(() => renderer!.unmount());
  expect(mockManager.removeEventListener).toHaveBeenCalledWith(
    'auth',
    expect.any(Function),
  );
});

test('index route redirects to the tabs explore feed', () => {
  const element = Index();
  expect(element.type).toBe(Redirect);
  expect(element.props.href).toBe('/ExploreTab');
});
