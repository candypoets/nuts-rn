import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { ScrollView, StyleSheet } from 'react-native';

import { SegmentedTabs } from '../src/components/SegmentedTabs';

const tabs = [
  { id: 'notes', label: 'Notes' },
  { id: 'media', label: 'Media' },
  { id: 'articles', label: 'Articles' },
  { id: 'events', label: 'Events' },
];

test('adaptive tabs fill the viewport and preserve a scrollable minimum width', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <SegmentedTabs
        tabs={tabs}
        selectedId="notes"
        onSelect={() => {}}
        layout="adaptive"
      />,
    );
  });

  const scrollView = renderer!.root.findByType(ScrollView);
  expect(StyleSheet.flatten(scrollView.props.style)).toMatchObject({
    width: '100%',
  });
  expect(
    StyleSheet.flatten(scrollView.props.contentContainerStyle),
  ).toMatchObject({
    minWidth: '100%',
  });

  const tabButtons = tabs.map(tab =>
    renderer!.root.findByProps({
      accessibilityLabel: `${
        tab.id === 'notes' ? 'Selected' : 'Select'
      } ${tab.label}`,
    }),
  );
  expect(tabButtons).toHaveLength(tabs.length);
  for (const button of tabButtons) {
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({
      flexBasis: 72,
      flexGrow: 1,
      flexShrink: 0,
    });
  }
});

test('adaptive tabs keep selection responsive', () => {
  const onSelect = jest.fn();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <SegmentedTabs
        tabs={tabs}
        selectedId="notes"
        onSelect={onSelect}
        layout="adaptive"
      />,
    );
  });

  const mediaButton = renderer!.root.findByProps({
    accessibilityLabel: 'Select Media',
  });
  const stopPropagation = jest.fn();
  act(() => mediaButton.props.onPress({stopPropagation}));

  expect(stopPropagation).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith('media');
});
