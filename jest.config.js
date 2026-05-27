module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    '\\.(css)$': '<rootDir>/__mocks__/styleMock.js',
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/__mocks__/async-storage.js',
    '^nostr-tools$': '<rootDir>/__mocks__/nostr-tools.js',
    '^@shopify/flash-list$': '<rootDir>/__mocks__/flash-list.js',
    '^react-native-reanimated$':
      '<rootDir>/__mocks__/react-native-reanimated.js',
  },
};
