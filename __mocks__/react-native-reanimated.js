const React = require('react');
const { View } = require('react-native');

const AnimatedView = React.forwardRef((props, ref) =>
  React.createElement(View, { ...props, ref }),
);

module.exports = {
  __esModule: true,
  default: {
    View: AnimatedView,
  },
  Extrapolation: {
    CLAMP: 'clamp',
  },
  ReanimatedLogLevel: {
    warn: 'warn',
  },
  configureReanimatedLogger() {},
  interpolate(value, input, output) {
    if (value <= input[0]) return output[0];
    if (value >= input[input.length - 1]) return output[output.length - 1];
    const range = input[1] - input[0] || 1;
    const progress = (value - input[0]) / range;
    return output[0] + progress * (output[1] - output[0]);
  },
  runOnJS(fn) {
    return fn;
  },
  useAnimatedStyle(factory) {
    return factory();
  },
  useSharedValue(initialValue) {
    return { value: initialValue };
  },
  withSpring(value, _config, callback) {
    callback?.(true);
    return value;
  },
  withTiming(value, _config, callback) {
    callback?.(true);
    return value;
  },
};
