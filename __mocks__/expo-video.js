const React = require('react');
const { View } = require('react-native');

const createPlayerStub = () => ({
  playing: false,
  loop: false,
  muted: false,
  currentTime: 0,
  duration: 0,
  play() {},
  pause() {},
  replace() {},
  replaceAsync() {},
  release() {},
  addListener() {
    return { remove() {} };
  },
});

const VideoView = React.forwardRef((props, ref) =>
  React.createElement(View, { ...props, ref }),
);

const useVideoPlayer = () => createPlayerStub();

const createVideoPlayer = () => createPlayerStub();

module.exports = {
  __esModule: true,
  VideoView,
  useVideoPlayer,
  createVideoPlayer,
};
