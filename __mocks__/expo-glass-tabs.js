const React = require('react');
const ReactNative = require('react-native');
const Reanimated = require('react-native-reanimated');

const mockMinimizeOnScroll = jest.fn();

function Passthrough({children}) {
  return children;
}

function GlassTabBar({children, ...props}) {
  return React.createElement(ReactNative.View, props, children);
}

function GlassTabButton(props) {
  return React.createElement(ReactNative.Pressable, props);
}

function useMinimizeOnScroll() {
  return Reanimated.useAnimatedScrollHandler({
    onScroll: event => mockMinimizeOnScroll(event),
  });
}

module.exports = {
  __esModule: true,
  GlassTabBar,
  GlassTabButton,
  TabBarMinimizeProvider: Passthrough,
  useMinimizeOnScroll,
  __mockMinimizeOnScroll: mockMinimizeOnScroll,
};
