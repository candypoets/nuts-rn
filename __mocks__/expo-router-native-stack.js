// Self-contained stub for expo-router's vendored native-stack fork
// ('expo-router/build/react-navigation/native-stack'), used by the embedded
// wizard navigators (SignupModal, MintingModal). The real
// @react-navigation/native-stack package is no longer installed.
// The stub renders only the initial screen (initialRouteName or the first
// Screen child) with a mock { navigation, route } prop pair, which is enough
// for component-level wizard tests.
const React = require('react');
const { __createMockNavigation } = require('./expo-router-react-navigation');

function createNativeStackNavigator() {
  function Screen() {
    return null;
  }

  function Navigator(props) {
    const navigation = React.useMemo(() => __createMockNavigation(), []);
    const screens = React.Children.toArray(props.children).filter(
      child => React.isValidElement(child) && child.type === Screen,
    );
    const initial =
      screens.find(screen => screen.props.name === props.initialRouteName) ||
      screens[0];
    if (!initial) {
      return null;
    }

    const route = {
      key: `${initial.props.name}-test`,
      name: initial.props.name,
      params: initial.props.initialParams,
    };

    const Component = initial.props.component;
    if (Component) {
      return React.createElement(Component, { navigation, route });
    }
    if (typeof initial.props.children === 'function') {
      return initial.props.children({ navigation, route });
    }
    return initial.props.children || null;
  }

  return { Navigator, Screen };
}

module.exports = {
  createNativeStackNavigator,
  useHeaderHeight: () => 0,
};
