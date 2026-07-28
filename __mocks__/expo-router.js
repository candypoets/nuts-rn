// Minimal expo-router mock for tests that render App.tsx (React Navigation).
// Router navigation is a no-op; components under test use useNavigation from
// the react-navigation shim for real navigation behavior.
const React = require('react');

const router = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
  dismiss: jest.fn(),
  dismissAll: jest.fn(),
  canGoBack: jest.fn(() => false),
  setParams: jest.fn(),
};

const passthrough = ({children}) => (children ? React.createElement(React.Fragment, null, children) : null);

module.exports = {
  router,
  useRouter: () => router,
  usePathname: () => '/',
  useSegments: () => [],
  useLocalSearchParams: () => ({}),
  useGlobalSearchParams: () => ({}),
  useFocusEffect: () => {},
  Link: passthrough,
  Redirect: () => null,
  Stack: passthrough,
  Tabs: passthrough,
};
module.exports.Stack.Screen = () => null;
module.exports.Tabs.Screen = () => null;
