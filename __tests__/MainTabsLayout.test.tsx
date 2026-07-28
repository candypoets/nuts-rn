import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {GlassTabBar} from 'expo-glass-tabs';
import {router} from 'expo-router';

let mockTabSlotContent: React.ReactNode = null;

jest.mock('expo-router/ui', () => {
  const ReactModule = require('react');
  const Passthrough = ({children}: {children?: React.ReactNode}) =>
    ReactModule.createElement(ReactModule.Fragment, null, children);
  return {
    Tabs: Passthrough,
    TabList: Passthrough,
    TabSlot: () => mockTabSlotContent,
    TabTrigger: Passthrough,
  };
});

jest.mock('expo-router/react-navigation', () => ({
  useIsFocused: () => true,
}));

jest.mock('../src/nostr/manager', () => ({
  getSharedNostrManager: () => null,
}));

import MainTabsLayout, {
  getInitialTabIndex,
  useMainTabContext,
} from '../app/(tabs)/_layout';

function ExploreScrollKeyProbe() {
  const {scrollToTopKey} = useMainTabContext('explore');
  return <Text testID="explore-scroll-key">{scrollToTopKey ?? 'unset'}</Text>;
}

beforeEach(() => {
  (router.navigate as jest.Mock).mockClear();
  mockTabSlotContent = <ExploreScrollKeyProbe />;
});

afterEach(() => {
  mockTabSlotContent = null;
});

test.each([
  ['/HomeTab', 0],
  ['/ExploreTab', 1],
  ['/ChatTab', 2],
  ['/', 1],
])('initial tab for %s is index %i', (pathname, expectedIndex) => {
  expect(getInitialTabIndex(pathname)).toBe(expectedIndex);
});

test('tab bar starts on Explore without the blur bleed', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  expect(renderer!.root.findByType(GlassTabBar).props).toMatchObject({
    backgroundBlur: false,
    blurBleed: 0,
    initialIndex: 1,
  });
});

test('selecting Explore again requests scroll-to-top without navigating', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  expect(
    renderer!.root.findByProps({testID: 'explore-scroll-key'}).props.children,
  ).toBe('unset');

  act(() => {
    renderer!.root.findByType(GlassTabBar).props.onIndexSelected(1);
  });

  expect(router.navigate).not.toHaveBeenCalled();
  expect(
    renderer!.root.findByProps({testID: 'explore-scroll-key'}).props.children,
  ).toBe(1);
});

test('selecting another tab navigates without changing the active scroll key', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  act(() => {
    renderer!.root.findByType(GlassTabBar).props.onIndexSelected(0);
  });

  expect(router.navigate).toHaveBeenCalledWith('/HomeTab');
  expect(
    renderer!.root.findByProps({testID: 'explore-scroll-key'}).props.children,
  ).toBe('unset');
});
