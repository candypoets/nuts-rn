// Self-contained stub for 'expo-router/react-navigation' (a re-export shim of
// @react-navigation/native). The real @react-navigation packages are no longer
// installed, so tests get a minimal navigation surface instead:
// - useNavigation returns a shared mock navigation object (jest.fn methods)
// - useIsFocused is always true
// - NavigationContext defaults to undefined, so components that read it via
//   useContext (Avatar, User) keep their real "no navigation" code path
const React = require('react');

function __createMockNavigation(overrides) {
  const state = {
    index: 0,
    key: 'stack-test',
    routeNames: [],
    routes: [],
    stale: false,
    type: 'stack',
  };
  return {
    addListener: jest.fn(() => jest.fn()),
    canGoBack: jest.fn(() => false),
    dispatch: jest.fn(),
    getId: jest.fn(() => 'test-stack'),
    getParent: jest.fn(() => undefined),
    getState: jest.fn(() => state),
    goBack: jest.fn(),
    isFocused: jest.fn(() => true),
    navigate: jest.fn(),
    pop: jest.fn(),
    popToTop: jest.fn(),
    push: jest.fn(),
    removeListener: jest.fn(),
    replace: jest.fn(),
    reset: jest.fn(),
    setOptions: jest.fn(),
    setParams: jest.fn(),
    ...overrides,
  };
}

const defaultNavigation = __createMockNavigation();

const NavigationContext = React.createContext(undefined);

function useNavigation() {
  const navigation = React.useContext(NavigationContext);
  return navigation == null ? defaultNavigation : navigation;
}

function NavigationContainer({ children }) {
  return React.createElement(
    NavigationContext.Provider,
    { value: defaultNavigation },
    children,
  );
}

const theme = {
  dark: false,
  colors: {
    primary: '#0a84ff',
    background: '#ffffff',
    card: '#ffffff',
    text: '#000000',
    border: '#d8d8d8',
    notification: '#ff453a',
  },
  fonts: {},
};

module.exports = {
  __createMockNavigation,
  NavigationContext,
  NavigationContainer,
  useNavigation,
  useIsFocused: () => true,
  useFocusEffect: () => {},
  useRoute: () => ({ key: 'test-route', name: 'Test', params: undefined }),
  DefaultTheme: theme,
  DarkTheme: { ...theme, dark: true },
};
