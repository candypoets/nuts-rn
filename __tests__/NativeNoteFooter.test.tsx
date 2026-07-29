import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { View } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import { NativeNoteFooter } from '../src/components/native/NativeNoteFooter';

jest.mock('../src/specs/NativeNoteFooterNativeComponent', () => {
  const ReactModule = require('react');
  const { View: NativeView } = require('react-native');

  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      ReactModule.createElement(NativeView, {
        ...props,
        testID: 'native-note-footer',
      }),
  };
});

test('passes the displayed note id separately from shared repost bytes', () => {
  const displayedNoteId = 'reposted-note-id';
  const note = {
    id: () => displayedNoteId,
    bb: { bytes_: new Uint8Array([1, 2, 3]) },
  } as unknown as ParsedEvent;

  let renderer: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(
      <NativeNoteFooter
        note={note}
        tintColor="#999999"
        primaryColor="#158777"
        accentColor="#6d28d9"
        onReply={() => {}}
        onComments={() => {}}
        onRepost={() => {}}
        onLike={() => {}}
        onShare={() => {}}
        onZap={() => {}}
      />,
    );
  });

  const nativeFooter = renderer!.root.find(
    node => node.type === View && node.props.testID === 'native-note-footer',
  );
  expect(nativeFooter.props.noteBytes).toEqual([1, 2, 3]);
  expect(nativeFooter.props.noteId).toBe(displayedNoteId);
});
