import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {ScrollView, Text, View} from 'react-native';
import {Feed, FeedSticky} from '../src/components/Feed';

type Item = {id: string};

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
        header={() => (
          <FeedSticky>
            <Text testID="sticky-title">Hashtag feed</Text>
          </FeedSticky>
        )}
        empty={<Text>empty</Text>}
      />,
    );
  });
  return renderer!;
}

function getStickyOverlayOpacity(root: ReactTestRenderer.ReactTestInstance) {
  const overlays = root.findAll(
    node => node.type === View && typeof node.props.style?.opacity === 'number',
  );
  expect(overlays).toHaveLength(1);
  return overlays[0].props.style.opacity as number;
}

test('FeedSticky mirrors the tagged header element into the sticky overlay', () => {
  const renderer = renderFeed();
  const titles = renderer.root.findAll(
    node => node.type === Text && node.props.testID === 'sticky-title',
  );
  // once in-flow in the header, once in the sticky overlay
  expect(titles).toHaveLength(2);
});

test('sticky header reveal is scroll-linked', () => {
  const renderer = renderFeed();
  const scrollView = renderer.root.findByType(ScrollView);

  expect(getStickyOverlayOpacity(renderer.root)).toBe(0);

  // scrolling down keeps the header hidden
  act(() => {
    scrollView.props.onScroll(makeScrollEvent(300));
  });
  expect(getStickyOverlayOpacity(renderer.root)).toBe(0);

  // scrolling back up reveals it proportionally to the scroll delta
  act(() => {
    scrollView.props.onScroll(makeScrollEvent(250));
  });
  expect(getStickyOverlayOpacity(renderer.root)).toBeCloseTo(50 / 88, 5);

  // near the top it hides again to hand off to the in-flow header
  act(() => {
    scrollView.props.onScroll(makeScrollEvent(10));
  });
  expect(getStickyOverlayOpacity(renderer.root)).toBe(0);
});
