import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

type NativeDebugLogEvent = {
  source?: string;
  event?: string;
  details?: string;
  ts?: number;
};

const moduleName = NativeModules.NativeDebugBridge;

const emitter =
  Platform.OS === 'ios' && moduleName
    ? new NativeEventEmitter(moduleName)
    : null;

export function subscribeNativeDebugLogs(
  onEvent: (event: NativeDebugLogEvent) => void,
) {
  if (!emitter) return () => {};

  if (__DEV__) {
    const subscription = emitter.addListener('nativeDebugLog', onEvent);
    return () => {
      subscription.remove();
    };
  }

  return () => {};
}

export function startNativeDebugLogRelay(
  onEvent: (event: NativeDebugLogEvent) => void,
) {
  if (!__DEV__ || Platform.OS !== 'ios') return () => {};

  return subscribeNativeDebugLogs(event => {
    onEvent(event);
  });
}
