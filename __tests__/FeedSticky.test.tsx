import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
} from 'react-native';
import * as SafeAreaContext from 'react-native-safe-area-context';
import {
  Feed,
  FeedHeaderDynamic,
  FeedSticky,
} from '../src/components/Feed';

const {__mockMinimizeOnScroll} = require('expo-glass-tabs') as {
  __mockMinimizeOnScroll: jest.Mock;
};

type Item = {id: string};

const {__setSafeAreaInsets} = SafeAreaContext as typeof SafeAreaContext & {
  __setSafeAreaInsets: (insets: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  }) => void;
};

const makeScrollEvent = (y: number) => ({
  nativeEvent: {
    contentOffset: {x: 0, y},
    contentSize: {height: 4000, width: 400},
    layoutMeasurement: {height: 800, width: 400},
  },
});

function renderFeed() {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={() => (
          <>
            <FeedSticky>
              <Text testID="sticky-title">Hashtag feed</Text>
            </FeedSticky>
            <FeedHeaderDynamic>
              <Text testID="dynamic-context">Relay context</Text>
            </FeedHeaderDynamic>
          </>
        )}
        empty={<Text>empty</Text>}
      />,
    );
  });
  return renderer!;
}

afterEach(() => {
  __mockMinimizeOnScroll.mockClear();
  __setSafeAreaInsets({top: 0, bottom: 0, left: 0, right: 0});
});

test('motion header renders one interactive tree with sticky and dynamic sections', () => {
  const renderer = renderFeed();
  const titles = renderer.root.findAll(
    node => node.type === Text && node.props.testID === 'sticky-title',
  );
  expect(titles).toHaveLength(1);
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.testID === 'dynamic-context',
    ),
  ).toHaveLength(1);
});

test('motion header keeps Feed scroll callbacks composed', () => {
  const renderer = renderFeed();
  const scrollView = renderer.root.findByType(ScrollView);

  act(() => {
    scrollView.props.onScroll(makeScrollEvent(300));
  });
  expect(
    renderer.root.findAll(
      node => node.type === Text && node.props.testID === 'sticky-title',
    ),
  ).toHaveLength(1);
});

test('motion header keeps the native pull-to-refresh indicator visible', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={() => (
          <FeedSticky>
            <Text>Refreshable feed</Text>
          </FeedSticky>
        )}
        pullToRefresh
        refreshing
        onRefresh={() => {}}
        empty={<Text>empty</Text>}
      />,
    );
  });

  const nativeControl = renderer!.root.findByType(RefreshControl);
  expect(nativeControl.props.refreshing).toBe(true);
  expect(nativeControl.props.tintColor).not.toBe('transparent');
  expect(
    renderer!.root.findAllByProps({testID: 'feed-refresh-indicator'}),
  ).toHaveLength(0);
});

test('content header stays inside the scroll view when motion chrome is present', () => {
  __setSafeAreaInsets({top: 32, bottom: 0, left: 0, right: 0});
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={() => <Text testID="motion-chrome">Post</Text>}
        header={({safeAreaTop}) => (
          <Text testID="in-flow-content">
            Root content safe area: {safeAreaTop}
          </Text>
        )}
        headerSafeArea
        empty={<Text>empty</Text>}
      />,
    );
  });

  const scrollView = renderer!.root.findByType(ScrollView);
  const inFlowContent = renderer!.root.findByProps({
    testID: 'in-flow-content',
  });
  const motionChrome = renderer!.root.findByProps({testID: 'motion-chrome'});
  const hasAncestor = (
    node: ReactTestRenderer.ReactTestInstance,
    ancestor: ReactTestRenderer.ReactTestInstance,
  ) => {
    let current = node.parent;
    while (current) {
      if (current === ancestor) return true;
      current = current.parent;
    }
    return false;
  };

  expect(hasAncestor(inFlowContent, scrollView)).toBe(true);
  expect(hasAncestor(motionChrome, scrollView)).toBe(false);
  expect(inFlowContent.props.children).toEqual([
    'Root content safe area: ',
    0,
  ]);
});

test('motion chrome can overlay hero content without adding a top offset', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={() => <Text>Profile controls</Text>}
        motionHeaderOverlaysContent
        motionHeaderSurfaceColor="transparent"
        header={() => <Text>Profile banner</Text>}
        empty={<Text>empty</Text>}
      />,
    );
  });

  const scrollView = renderer!.root.findByType(ScrollView);
  expect(scrollView.props.contentContainerStyle).toBeUndefined();
});

test('feed forwards animated scroll events to the glass tab minimizer', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        empty={<Text>empty</Text>}
      />,
    );
  });

  const scrollView = renderer!.root.findByType(ScrollView);
  act(() => {
    scrollView.props.onScroll(makeScrollEvent(300));
  });

  expect(__mockMinimizeOnScroll).toHaveBeenCalledWith(
    expect.objectContaining({contentOffset: {x: 0, y: 300}}),
  );
});

test('refresh indicator owns the safe-area slot and unmounts after refresh', () => {
  __setSafeAreaInsets({top: 32, bottom: 0, left: 0, right: 0});
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        header={({safeAreaTop}) => (
          <Text testID="refresh-header-safe-area">{safeAreaTop}</Text>
        )}
        headerSafeArea
        headerOwnsSafeArea
        pullToRefresh
        refreshing
        onRefresh={() => {}}
      />,
    );
  });

  const nativeControl = renderer!.root.findByType(RefreshControl);
  const scrollView = renderer!.root.findByType(ScrollView);
  expect(nativeControl.props.progressViewOffset).toBe(24);
  expect(nativeControl.props.refreshing).toBe(false);
  expect(nativeControl.props.tintColor).toBe('transparent');
  expect(scrollView.props.maintainVisibleContentPosition).toBeUndefined();
  expect(
    renderer!.root.findByProps({testID: 'refresh-header-safe-area'}).props
      .children,
  ).toBe(0);
  expect(
    renderer!.root.findByProps({testID: 'feed-refresh-indicator'}).props.style,
  ).toMatchObject({height: 72, paddingTop: 24});
  expect(renderer!.root.findAllByType(ActivityIndicator)).toHaveLength(1);

  act(() => {
    renderer!.update(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        header={({safeAreaTop}) => (
          <Text testID="refresh-header-safe-area">{safeAreaTop}</Text>
        )}
        headerSafeArea
        headerOwnsSafeArea
        pullToRefresh
        refreshing={false}
        onRefresh={() => {}}
      />,
    );
  });

  expect(
    renderer!.root.findAllByProps({testID: 'feed-refresh-indicator'}),
  ).toHaveLength(0);
  expect(renderer!.root.findAllByType(ActivityIndicator)).toHaveLength(0);
  expect(
    renderer!.root.findByType(ScrollView).props.maintainVisibleContentPosition,
  ).toEqual({minIndexForVisible: 0});
  expect(
    renderer!.root.findByProps({testID: 'refresh-header-safe-area'}).props
      .children,
  ).toBe(24);

  act(() => renderer!.unmount());
});
