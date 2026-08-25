import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {ScrollView, Text} from 'react-native';
import HeaderMotion from 'react-native-header-motion';
import {Feed} from '../src/components/Feed';

type Item = {id: string};

function renderMotionFeed(unwrappedMotionContent: boolean) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <Feed<Item>
        items={[]}
        renderItem={() => null}
        motionHeader={() => <Text testID="motion-header">Post</Text>}
        empty={<Text>empty</Text>}
        unwrappedMotionContent={unwrappedMotionContent}
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
    expect(scrollView.props.contentContainerStyle).toEqual({paddingTop: 0});

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
});
