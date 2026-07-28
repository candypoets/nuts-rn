/**
 * App-shell smoke test for the expo-router entry.
 *
 * The pre-migration App.test rendered App.tsx — a React Navigation container
 * hosting the tab/stack navigators and the initial feed. The entry point is
 * now expo-router/entry and the shell is app/_layout.tsx. renderRouter()
 * cannot be used here (@testing-library/react-native is not installed), so
 * this mounts the root layout directly under the standard module mocks and
 * asserts the provider tree, the root Stack with its (tabs) screen, the
 * RootServices auth wiring, and the / -> /ExploreTab redirect.
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
  expect(screens).toHaveLength(1);
  expect(screens[0].props.name).toBe('(tabs)');
  expect(screens[0].props.options).toEqual({freezeOnBlur: false});

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
