module.exports = {
  preset: 'jest-expo',
  transformIgnorePatterns: [
    '/node_modules/(?!(react-native|@react-native|@react-native-community|expo|@expo|@expo-google-fonts|expo-router|expo-linking|react-navigation|@react-navigation|nativewind|react-native-css-interop|@legendapp|@noble|@scure|@candypoets|nostr-tools))',
    '/node_modules/react-native-reanimated/plugin/',
    '/node_modules/@react-native/babel-preset/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/ios/build',
    '<rootDir>/ios/ios',
    '<rootDir>/android/build',
    '<rootDir>/build',
  ],
  moduleNameMapper: {
    '^expo-router/react-navigation$':
      '<rootDir>/__mocks__/expo-router-react-navigation.js',
    '^expo-router/build/react-navigation/native-stack$':
      '<rootDir>/__mocks__/expo-router-native-stack.js',
    '^expo-router$': '<rootDir>/__mocks__/expo-router.js',
    '\\.(css)$': '<rootDir>/__mocks__/styleMock.js',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/__mocks__/async-storage.js',
    '^nostr-tools$': '<rootDir>/__mocks__/nostr-tools.js',
    '^expo-video$': '<rootDir>/__mocks__/expo-video.js',
    '^@react-native-community/datetimepicker$':
      '<rootDir>/__mocks__/datetimepicker.js',
    '^@shopify/flash-list$': '<rootDir>/__mocks__/flash-list.js',
    '^react-native-gesture-handler$':
      '<rootDir>/__mocks__/react-native-gesture-handler.js',
    '^react-native-safe-area-context$':
      '<rootDir>/__mocks__/react-native-safe-area-context.js',
    '^react-native-keyboard-controller$':
      'react-native-keyboard-controller/jest',
    '^react-native-reanimated$':
      '<rootDir>/__mocks__/react-native-reanimated.js',
    '^react-native-worklets$':
      '<rootDir>/__mocks__/react-native-worklets.js',
  },
};
