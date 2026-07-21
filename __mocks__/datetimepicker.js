const React = require('react');
const { View } = require('react-native');

const DateTimePicker = React.forwardRef((props, ref) =>
  React.createElement(View, { ...props, ref, testID: props.testID || 'DateTimePicker' }),
);

module.exports = {
  __esModule: true,
  default: DateTimePicker,
  DateTimePickerEvent: {},
};
