const base = require('../jest.config');
module.exports = {
  ...base,
  rootDir: '..',
  moduleNameMapper: {
    ...base.moduleNameMapper,
    '^@candypoets/nipworker$': '<rootDir>/spike/__mocks__/nipworker-root.js',
    '^@candypoets/nipworker/hooks$': '<rootDir>/spike/__mocks__/nipworker-hooks.js',
    '^@candypoets/nipworker/utils$': '<rootDir>/spike/__mocks__/nipworker-utils.js',
    '^@candypoets/nipworker/react-native$': '<rootDir>/spike/__mocks__/nipworker-root.js',
  },
};
