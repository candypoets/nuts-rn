import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {Text} from 'react-native';
import {GlassTabBar} from 'expo-glass-tabs';

let mockTabSlotContent: React.ReactNode = null;
let mockActiveTabIndex = 1;
const mockTabRoutes = [
  {key: 'HomeTab-key', name: 'HomeTab'},
  {key: 'ExploreTab-key', name: 'ExploreTab'},
  {key: 'ChatTab-key', name: 'ChatTab'},
];
const mockTabNavigation = {
  dispatch: jest.fn(),
  emit: jest.fn(() => ({defaultPrevented: false})),
  getState: jest.fn(() => ({
    index: mockActiveTabIndex,
    key: 'main-tabs',
    routes: mockTabRoutes,
  })),
};

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
  useNavigation: () => mockTabNavigation,
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
  mockActiveTabIndex = 1;
  mockTabNavigation.dispatch.mockClear();
  mockTabNavigation.emit.mockClear();
  mockTabNavigation.getState.mockClear();
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

test('tab bar starts on Explore', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  expect(renderer!.root.findByType(GlassTabBar).props).toMatchObject({
    initialIndex: 1,
  });
});

test('selecting Explore again requests scroll-to-top without dispatching', () => {
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

  expect(mockTabNavigation.dispatch).not.toHaveBeenCalled();
  expect(mockTabNavigation.emit).toHaveBeenCalledWith({
    type: 'tabPress',
    target: 'ExploreTab-key',
    canPreventDefault: true,
  });
  expect(
    renderer!.root.findByProps({testID: 'explore-scroll-key'}).props.children,
  ).toBe(1);
});

test('selecting another tab jumps directly without changing the active scroll key', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  act(() => {
    renderer!.root.findByType(GlassTabBar).props.onIndexSelected(0);
  });

  expect(mockTabNavigation.dispatch).toHaveBeenCalledWith({
    type: 'JUMP_TO',
    target: 'main-tabs',
    payload: {name: 'HomeTab'},
  });
  expect(
    renderer!.root.findByProps({testID: 'explore-scroll-key'}).props.children,
  ).toBe('unset');
});

test('a prevented tab press neither jumps nor scrolls', () => {
  mockTabNavigation.emit.mockReturnValueOnce({defaultPrevented: true});

  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  act(() => {
    renderer!.root.findByType(GlassTabBar).props.onIndexSelected(1);
  });

  expect(mockTabNavigation.dispatch).not.toHaveBeenCalled();
  expect(
    renderer!.root.findByProps({testID: 'explore-scroll-key'}).props.children,
  ).toBe('unset');
});
