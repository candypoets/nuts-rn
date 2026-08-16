import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { View } from 'react-native';
import { MediaActivityProvider } from '../src/media/MediaActivity';
import { NativeMediaViewer } from '../src/components/native/NativeMediaViewer.ios';

jest.mock('../src/specs/NativeMediaViewerNativeComponent', () => {
  const ReactModule = require('react');
  const { View: NativeView } = require('react-native');

  return {
    __esModule: true,
    default: (props: Record<string, unknown>) =>
      ReactModule.createElement(NativeView, {
        ...props,
        testID: 'native-media-viewer',
      }),
  };
});

jest.mock('../src/components/notes/footerActions', () => ({
  footerColors: {
    tint: '#999999',
    primary: '#158777',
    accent: '#6d28d9',
  },
  useNoteFooterActions: () => ({
    currentUserPubkey: undefined,
    optimisticReactionNonce: 0,
    handleAction: jest.fn(),
  }),
}));

jest.mock('../src/theme', () => ({
  useAppTheme: () => ({ colors: { base200: '#222222' } }),
}));

test('combines data visibility with row media activity for native playback', () => {
  const render = (visible: boolean, mediaActive: boolean) => (
    <MediaActivityProvider active={mediaActive}>
      <NativeMediaViewer
        links={[{ src: 'https://example.test/video.mp4', type: 'video' }]}
        visible={visible}
      />
    </MediaActivityProvider>
  );
  let renderer: ReactTestRenderer.ReactTestRenderer;

  act(() => {
    renderer = ReactTestRenderer.create(render(true, false));
  });
  const nativeViewer = () =>
    renderer!.root.find(
      node => node.type === View && node.props.testID === 'native-media-viewer',
    );

  expect(nativeViewer().props.playbackActive).toBe(false);

  act(() => {
    renderer!.update(render(true, true));
  });
  expect(nativeViewer().props.playbackActive).toBe(true);

  act(() => {
    renderer!.update(render(false, true));
  });
  expect(nativeViewer().props.playbackActive).toBe(false);
});
