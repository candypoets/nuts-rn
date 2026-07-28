import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {GlassTabBar} from 'expo-glass-tabs';

jest.mock('expo-router/ui', () => {
  const ReactModule = require('react');
  const Passthrough = ({children}: {children?: React.ReactNode}) =>
    ReactModule.createElement(ReactModule.Fragment, null, children);
  return {
    Tabs: Passthrough,
    TabList: Passthrough,
    TabSlot: () => null,
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
} from '../app/(tabs)/_layout';

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
    blurBleed: 0,
    initialIndex: 1,
  });
});
