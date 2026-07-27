const React = require('react');

const insets = {top: 0, bottom: 0, left: 0, right: 0};
const frame = {x: 0, y: 0, width: 320, height: 640};

const SafeAreaProvider = ({children}) => React.createElement(React.Fragment, null, children);
const SafeAreaView = ({children, ...props}) =>
  React.createElement(require('react-native').View, props, children);

module.exports = {
  __esModule: true,
  SafeAreaProvider,
  SafeAreaView,
  SafeAreaInsetsContext: React.createContext(insets),
  SafeAreaFrameContext: React.createContext(frame),
  useSafeAreaInsets: () => insets,
  useSafeAreaFrame: () => frame,
  initialWindowMetrics: {insets, frame},
  __setSafeAreaInsets: next => Object.assign(insets, next),
};
