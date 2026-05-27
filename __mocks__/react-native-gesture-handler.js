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
    'onBegin',
    'onEnd',
    'onUpdate',
  ];
  methods.forEach(method => {
    gesture[method] = () => gesture;
  });
  return gesture;
}

module.exports = {
  Gesture: {
    Pan: chainableGesture,
  },
  GestureDetector: ({children}) => children,
  GestureHandlerRootView,
};
