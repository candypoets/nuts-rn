import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

let mockTabScreenContent: React.ReactNode = null;
let mockNativeTabsProps: Record<string, unknown> | null = null;
let mockTriggerProps: Record<string, unknown>[] = [];

jest.mock('expo-router/unstable-native-tabs', () => {
  const ReactModule = require('react');
  const NativeTabs = ({
    children,
    ...props
  }: {
    children: React.ReactNode;
  }) => {
    mockNativeTabsProps = props;
    return ReactModule.createElement(
      ReactModule.Fragment,
      null,
      children,
      mockTabScreenContent,
    );
  };
  const Trigger = ({ children, ...props }: { children: React.ReactNode }) => {
    mockTriggerProps.push(props);
    return ReactModule.createElement(ReactModule.Fragment, null, children);
  };
  Trigger.Label = () => null;
  Trigger.Icon = () => null;
  NativeTabs.Trigger = Trigger;
  return { NativeTabs };
});

jest.mock('expo-router/react-navigation', () => ({
  useIsFocused: () => true,
}));

jest.mock('../src/nostr/manager', () => ({
  getSharedNostrManager: () => null,
}));

import MainTabsLayout, { useMainTabContext } from '../src/app/(tabs)/_layout';

function ExploreScrollKeyProbe() {
  const { scrollToTopKey } = useMainTabContext('explore');
  return <Text testID="explore-scroll-key">{scrollToTopKey ?? 'unset'}</Text>;
}

beforeEach(() => {
  mockNativeTabsProps = null;
  mockTriggerProps = [];
  mockTabScreenContent = <ExploreScrollKeyProbe />;
});

afterEach(() => {
  mockTabScreenContent = null;
});

test('renders all three routes through the native tab host', () => {
  act(() => {
    ReactTestRenderer.create(<MainTabsLayout />);
  });

  expect(mockNativeTabsProps).toMatchObject({
    backBehavior: 'initialRoute',
    minimizeBehavior: 'onScrollDown',
    sidebarAdaptable: false,
  });
  expect(mockTriggerProps.map(props => props.name)).toEqual([
    'HomeTab',
    'ExploreTab',
    'ChatTab',
  ]);
  expect(
    mockTriggerProps.every(props => props.disableAutomaticContentInsets),
  ).toBe(true);
});

test('selecting Explore again requests scroll-to-top', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  expect(
    renderer!.root.findByProps({ testID: 'explore-scroll-key' }).props.children,
  ).toBe('unset');

  const exploreTrigger = mockTriggerProps.find(
    props => props.name === 'ExploreTab',
  );
  const listeners = (
    exploreTrigger!.listeners as (props: {
      navigation: { isFocused: () => boolean };
    }) => { tabPress: () => void }
  )({
    navigation: { isFocused: () => true },
  });

  act(() => {
    listeners.tabPress();
  });

  expect(
    renderer!.root.findByProps({ testID: 'explore-scroll-key' }).props.children,
  ).toBe(1);
});

test('selecting an inactive tab leaves its scroll position alone', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(<MainTabsLayout />);
  });

  const exploreTrigger = mockTriggerProps.find(
    props => props.name === 'ExploreTab',
  );
  const listeners = (
    exploreTrigger!.listeners as (props: {
      navigation: { isFocused: () => boolean };
    }) => { tabPress: () => void }
  )({
    navigation: { isFocused: () => false },
  });

  act(() => {
    listeners.tabPress();
  });

  expect(
    renderer!.root.findByProps({ testID: 'explore-scroll-key' }).props.children,
  ).toBe('unset');
});
