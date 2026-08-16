import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
} from 'react-native';
import * as SafeAreaContext from 'react-native-safe-area-context';
import HeaderMotion from 'react-native-header-motion';
import {
  Feed,
  FeedHeaderDynamic,
  FeedSticky,
} from '../src/components/Feed';
import {useMediaActivity} from '../src/media/MediaActivity';

type Item = {id: string};

function MediaActivityStatus({id}: {id: string}) {
  const active = useMediaActivity();
  return <Text testID={`media-${id}`}>{active ? 'active' : 'paused'}</Text>;
}

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

test('motion header can expose a scroll-to-top press surface', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={() => <Text>Explore header</Text>}
        motionHeaderPressToTop
        empty={<Text>empty</Text>}
      />,
    );
  });

  const pressSurface = renderer!.root.findByProps({
    testID: 'motion-header-scroll-to-top',
  });
  expect(pressSurface.props.onPress).toEqual(expect.any(Function));
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

test('motion feed exposes its scroll view as the first native descendant', () => {
  const renderer = renderFeed();
  const feedSurface = renderer.root.find(
    node =>
      (node.type as unknown) === 'View' &&
      node.props.className === 'relative flex-1',
  );
  const firstChild = feedSurface.children[0];

  expect(feedSurface.props.collapsable).toBe(false);
  expect(typeof firstChild).not.toBe('string');
  expect((firstChild as ReactTestRenderer.ReactTestInstance).type).toBe(
    HeaderMotion.ScrollView,
  );
  expect(
    (firstChild as ReactTestRenderer.ReactTestInstance).props
      .contentInsetAdjustmentBehavior,
  ).toBe('never');
  expect(
    (firstChild as ReactTestRenderer.ReactTestInstance).findAllByType(
      ScrollView,
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

test('row viewport activity is independent from data visibility', () => {
  const render = (screenActive: boolean) => (
    <Feed<Item>
      items={[{id: 'one'}]}
      screenActive={screenActive}
      renderItem={({item, visible}) => (
        <>
          <Text testID={`row-${item.id}`}>
            {visible ? 'subscribed' : 'stopped'}
          </Text>
          <MediaActivityStatus id={item.id} />
        </>
      )}
    />
  );
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(render(true));
  });

  expect(renderer!.root.findByProps({testID: 'row-one'}).props.children).toBe(
    'subscribed',
  );
  expect(renderer!.root.findByProps({testID: 'media-one'}).props.children).toBe(
    'active',
  );
  const virtualRow = renderer!.root.findByProps({nativeID: 'one'});
  act(() => {
    virtualRow.props.onModeChange({
      mode: 2,
      target: virtualRow,
      renderState: 1,
      targetRect: {x: 0, y: 0, width: 320, height: 240},
      thresholdRect: {x: 0, y: 0, width: 320, height: 800},
    });
  });
  expect(renderer!.root.findByProps({testID: 'row-one'}).props.children).toBe(
    'subscribed',
  );
  expect(renderer!.root.findByProps({testID: 'media-one'}).props.children).toBe(
    'paused',
  );

  act(() => {
    virtualRow.props.onModeChange({
      mode: 0,
      target: virtualRow,
      renderState: 1,
      targetRect: {x: 0, y: 0, width: 320, height: 240},
      thresholdRect: {x: 0, y: 0, width: 320, height: 800},
    });
  });
  expect(renderer!.root.findByProps({testID: 'media-one'}).props.children).toBe(
    'active',
  );

  act(() => {
    renderer!.update(render(false));
  });
  expect(renderer!.root.findByProps({testID: 'row-one'}).props.children).toBe(
    'subscribed',
  );
  expect(renderer!.root.findByProps({testID: 'media-one'}).props.children).toBe(
    'paused',
  );

  act(() => {
    renderer!.update(render(true));
  });
  expect(renderer!.root.findByProps({testID: 'media-one'}).props.children).toBe(
    'active',
  );
});

test('overlay motion chrome can own the safe area above hero content', () => {
  __setSafeAreaInsets({top: 32, bottom: 0, left: 0, right: 0});
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={({safeAreaTop}) => (
          <Text testID="motion-safe-area">{safeAreaTop}</Text>
        )}
        motionHeaderOverlaysContent
        motionHeaderSurfaceColor="transparent"
        header={() => <Text>Community hero</Text>}
        headerSafeArea
        headerOwnsSafeArea
        empty={<Text>empty</Text>}
      />,
    );
  });

  expect(
    renderer!.root.findByProps({testID: 'motion-safe-area'}).props.children,
  ).toBe(24);
  expect(
    renderer!.root.findByType(ScrollView).props.contentContainerStyle,
  ).toBeUndefined();
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
