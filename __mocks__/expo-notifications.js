const responseListeners = new Set();
const tokenListeners = new Set();

module.exports = {
  AndroidImportance: { HIGH: 4 },
  addPushTokenListener(listener) {
    tokenListeners.add(listener);
    return { remove: () => tokenListeners.delete(listener) };
  },
  addNotificationResponseReceivedListener(listener) {
    responseListeners.add(listener);
    return { remove: () => responseListeners.delete(listener) };
  },
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  getDevicePushTokenAsync: jest.fn(async () => ({
    type: 'android',
    data: 'native-device-token',
  })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  setNotificationHandler: jest.fn(),
};
