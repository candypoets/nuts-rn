const React = require('react');
const {View} = require('react-native');

const GestureHandlerRootView = React.forwardRef((props, ref) =>
  React.createElement(View, {...props, ref}),
);

function chainableGesture() {
  const gesture = {};
  const methods = [
    'activeOffsetX',
    'enabled',
    'failOffsetY',
    'manualActivation',
    'maxPointers',
    'numberOfTaps',
    'onBegin',
    'onChange',
    'onEnd',
    'onFinalize',
    'onStart',
    'onTouchesDown',
    'onTouchesMove',
    'onUpdate',
    'shouldCancelWhenOutside',
  ];
  methods.forEach(method => {
    gesture[method] = () => gesture;
  });
  return gesture;
}

module.exports = {
  Gesture: {
    Pan: chainableGesture,
    Pinch: chainableGesture,
    Simultaneous: (...gestures) => ({gestures}),
    Tap: chainableGesture,
  },
  GestureDetector: ({children}) => children,
  GestureHandlerRootView,
};
