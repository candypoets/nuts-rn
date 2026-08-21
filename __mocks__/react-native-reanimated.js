const React = require('react');
const ReactNative = require('react-native');

const AnimatedView = React.forwardRef((props, ref) =>
  React.createElement(ReactNative.View, {...props, ref}),
);

function createAnimatedComponent(Component) {
  return React.forwardRef((props, ref) =>
    React.createElement(Component, {...props, ref}),
  );
}

function makeSharedValue(initialValue) {
  return {
    value: initialValue,
    get() {
      return this.value;
    },
    set(value) {
      this.value = typeof value === 'function' ? value(this.value) : value;
    },
    modify(modifier) {
      this.value = modifier(this.value);
    },
  };
}

module.exports = {
  __esModule: true,
  default: {
    View: AnimatedView,
    ScrollView: createAnimatedComponent(ReactNative.ScrollView),
    FlatList: createAnimatedComponent(ReactNative.FlatList),
    createAnimatedComponent,
  },
  Extrapolation: {
    CLAMP: 'clamp',
  },
  ReduceMotion: {
    Always: 'always',
    Never: 'never',
    System: 'system',
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
  cancelAnimation() {},
  createAnimatedComponent,
  scrollTo(ref, x, y, animated) {
    ref.current?.scrollTo?.({x, y, animated});
  },
  useAnimatedReaction() {},
  useAnimatedRef() {
    const ref = React.useRef(null);
    const animatedRef = value => {
      ref.current = value;
      animatedRef.current = value;
    };
    animatedRef.current = ref.current;
    return animatedRef;
  },
  useAnimatedScrollHandler(handlers) {
    const context = {};
    const handler = event => {
      handlers.onScroll?.(event.nativeEvent ?? event, context);
    };
    handler.workletEventHandler = {};
    return handler;
  },
  useComposedEventHandler(handlers) {
    const composed = event => {
      handlers.filter(Boolean).forEach(handler => handler(event));
    };
    composed.workletEventHandler = {};
    return composed;
  },
  useDerivedValue(factory) {
    return {
      get: factory,
      get value() {
        return factory();
      },
    };
  },
  useEvent(handler) {
    const eventHandler = event => handler(event.nativeEvent ?? event);
    eventHandler.workletEventHandler = {};
    return eventHandler;
  },
  useAnimatedStyle(factory) {
    return factory();
  },
  useReducedMotion() {
    return false;
  },
  useSharedValue(initialValue) {
    const ref = React.useRef(null);
    if (ref.current === null) ref.current = makeSharedValue(initialValue);
    return ref.current;
  },
  withSpring(value, _config, callback) {
    callback?.(true);
    return value;
  },
  withDecay(_config, callback) {
    callback?.(true);
    return 0;
  },
  withTiming(value, _config, callback) {
    callback?.(true);
    return value;
  },
};
