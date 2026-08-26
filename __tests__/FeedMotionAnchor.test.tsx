import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {ScrollView, Text} from 'react-native';
import HeaderMotion from 'react-native-header-motion';
import {Feed, type FeedScrollAdjust} from '../src/components/Feed';

type Item = {id: string};

function renderMotionFeed(
  unwrappedMotionContent: boolean,
  maintainVisibleContentMinIndex?: number,
) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={() => <Text testID="motion-header">Post</Text>}
        empty={<Text>empty</Text>}
        unwrappedMotionContent={unwrappedMotionContent}
        maintainVisibleContentMinIndex={maintainVisibleContentMinIndex}
      />,
    );
  });
  return renderer!;
}

describe('Feed unwrappedMotionContent', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('default motion path keeps the library content wrapper and immediate MVCP', () => {
    const renderer = renderMotionFeed(false);

    // The library scrollable stays in the tree and offsets content by
    // wrapping children in a padded view.
    renderer.root.findByType(HeaderMotion.ScrollView);
    const scrollView = renderer.root.findByType(ScrollView);
    expect(scrollView.props.contentContainerStyle ?? null).toBeNull();
    const wrapper = React.Children.only(
      scrollView.props.children,
    ) as React.ReactElement<{style?: unknown}>;
    expect(wrapper.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({paddingTop: 0})]),
    );

    // MVCP is enabled right away on the wrapped path (where the anchor
    // helper can only see the wrapper, never the rows).
    expect(scrollView.props.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 0,
    });
  });

  test('unwrapped motion path drops the wrapper and moves the header offset to contentContainerStyle', () => {
    const renderer = renderMotionFeed(true);

    expect(renderer.root.findAllByType(HeaderMotion.ScrollView)).toHaveLength(
      0,
    );
    renderer.root.findByType(HeaderMotion.ScrollManager);
    const scrollView = renderer.root.findByType(ScrollView);
    // Array form: header offset first, then the caller's contentContainerStyle
    // (undefined when not provided, e.g. the thread's bottom padding).
    expect(scrollView.props.contentContainerStyle).toEqual([
      {paddingTop: 0},
      undefined,
    ]);

    // No single padded wrapper child: rows become direct scroll children so
    // the platform anchor helper can see them.
    const children = React.Children.toArray(scrollView.props.children);
    const paddedWrapper = children.filter(child =>
      Boolean(
        child &&
          React.isValidElement<{style?: unknown}>(child) &&
          Array.isArray(child.props.style) &&
          child.props.style.some(
            entry => entry && (entry as {paddingTop?: number}).paddingTop === 0,
          ),
      ),
    );
    expect(paddedWrapper).toHaveLength(0);
  });

  test('unwrapped motion path latches maintainVisibleContentPosition on after content settles', () => {
    const renderer = renderMotionFeed(true);
    jest.useFakeTimers();

    let scrollView = renderer.root.findByType(ScrollView);
    // Not enabled at mount: the header's paddingTop transition (0 -> measured)
    // must not be compensated as prepended content.
    expect(
      scrollView.props.maintainVisibleContentPosition ?? null,
    ).toBeNull();

    act(() => {
      scrollView.props.onContentSizeChange(400, 1000);
    });
    act(() => {
      jest.advanceTimersByTime(10);
    });

    scrollView = renderer.root.findByType(ScrollView);
    expect(scrollView.props.maintainVisibleContentPosition).toEqual({
      minIndexForVisible: 0,
    });
  });

  test('unwrapped motion path forwards maintainVisibleContentMinIndex', () => {
    const renderer = renderMotionFeed(true, 2);
    jest.useFakeTimers();

    const scrollView = renderer.root.findByType(ScrollView);
    act(() => {
      scrollView.props.onContentSizeChange(400, 1000);
    });
    act(() => {
      jest.advanceTimersByTime(10);
    });

    expect(
      renderer.root.findByType(ScrollView).props
        .maintainVisibleContentPosition,
    ).toEqual({ minIndexForVisible: 2 });
  });

  test('scrollAdjustRef scrollBy shifts the offset and accumulates same-frame deltas', () => {
    // The animated ref lands on the ScrollView instance; shadow its scrollTo
    // with a spy after mount.
    const adjustRef = React.createRef<FeedScrollAdjust>();
    let renderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <Feed<Item>
          items={[]}
          renderItem={() => null}
          motionHeader={() => <Text testID="motion-header">Post</Text>}
          empty={<Text>empty</Text>}
          unwrappedMotionContent
          scrollAdjustRef={adjustRef}
        />,
      );
    });
    jest.useFakeTimers();
    const scrollView = renderer!.root.findByType(ScrollView);
    const scrollTo = jest.fn();
    (scrollView.instance as unknown as { scrollTo: jest.Mock }).scrollTo =
      scrollTo;

    expect(adjustRef.current).not.toBeNull();
    act(() => {
      adjustRef.current!.scrollBy(490);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 490, animated: false });

    // A second delta in the same frame must build on the pending offset: the
    // shared value only catches up once the native scroll event lands.
    act(() => {
      adjustRef.current!.scrollBy(-170);
    });
    expect(scrollTo).toHaveBeenLastCalledWith({ y: 320, animated: false });

    // Flush the pending-offset reset frame before teardown.
    act(() => {
      jest.advanceTimersByTime(1);
    });
  });
});
