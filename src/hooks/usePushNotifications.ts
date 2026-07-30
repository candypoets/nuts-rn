import { useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

import { DEFAULT_FEED_RELAYS } from '../nostr/relays';
import { pushNotificationRoute } from '../notifications/pushNavigation';
import {
  normalizePushRelays,
  registerPushDevice,
  unregisterPushDevice,
} from '../notifications/pushRegistration';
import type { PushPlatform } from '../notifications/pushRegistration';
import { useAuthStore, useNostrStore } from '../stores';

type NativePushDevice = {
  platform: PushPlatform;
  token: string;
};

let currentPushDevice: NativePushDevice | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export function getCurrentPushToken() {
  return currentPushDevice?.token ?? null;
}

function nativePushPlatform(): PushPlatform | null {
  if (Platform.OS === 'ios') return __DEV__ ? 'apns-sandbox' : 'apns';
  if (Platform.OS === 'android') return 'fcm';
  return null;
}

function nativeTokenData(token: Notifications.DevicePushToken) {
  return typeof token.data === 'string'
    ? token.data
    : JSON.stringify(token.data);
}

// A build without google-services/Firebase credentials can never acquire a
// token — an expected environment gap, not an error. It must not go through
// console.error: the dev LogBox banner overlays (and swallows taps meant for)
// bottom-bar UI on every launch.
function isMissingFirebaseConfig(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('FirebaseApp is not initialized') ||
    message.includes('Firebase Messaging instance') ||
    message.includes('googleServicesFile')
  );
}

async function acquireNativePushDevice(): Promise<NativePushDevice | null> {
  const platform = nativePushPlatform();
  if (!platform) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission =
    existing.status === 'undetermined'
      ? await Notifications.requestPermissionsAsync()
      : existing;
  if (permission.status !== 'granted') return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return { platform, token: nativeTokenData(token) };
}

export function usePushNotifications(enabled: boolean) {
  const router = useRouter();
  const pubkey = useAuthStore(state => state.pubkey);
  const readRelays = useNostrStore(state => state.readRelays);
  const [device, setDevice] = useState<NativePushDevice | null>(
    currentPushDevice,
  );
  const relays = useMemo(
    () =>
      normalizePushRelays(
        readRelays.length > 0 ? readRelays : DEFAULT_FEED_RELAYS,
      ),
    [readRelays],
  );
  const relaysKey = relays.join(',');

  useEffect(() => {
    if (!enabled || !pubkey) return;
    let cancelled = false;
    const updateDevice = (nextDevice: NativePushDevice) => {
      const previousToken = currentPushDevice?.token;
      currentPushDevice = nextDevice;
      setDevice(nextDevice);
      if (previousToken && previousToken !== nextDevice.token) {
        unregisterPushDevice(previousToken).catch(error => {
          console.error('[push] failed to unregister rotated token', error);
        });
      }
    };
    acquireNativePushDevice()
      .then(nextDevice => {
        if (cancelled || !nextDevice) return;
        updateDevice(nextDevice);
      })
      .catch(error => {
        if (isMissingFirebaseConfig(error)) {
          console.log(
            '[push] native push unavailable: Firebase is not configured in this build',
          );
          return;
        }
        console.error('[push] failed to acquire native push token', error);
      });
    const subscription = Notifications.addPushTokenListener(nextToken => {
      if (cancelled) return;
      const platform = nativePushPlatform();
      if (!platform) return;
      const nextDevice = {
        platform,
        token: nativeTokenData(nextToken),
      };
      updateDevice(nextDevice);
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [enabled, pubkey]);

  useEffect(() => {
    if (!enabled || !pubkey || !device || relays.length === 0) return;
    const timeout = setTimeout(() => {
      registerPushDevice(device.platform, device.token, relays).catch(error => {
        console.error('[push] failed to register device', error);
      });
    }, 750);
    return () => clearTimeout(timeout);
  }, [device, enabled, pubkey, relays, relaysKey]);

  useEffect(() => {
    const openNotification = (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data;
      router.push(pushNotificationRoute(data ?? {}));
    };
    const subscription =
      Notifications.addNotificationResponseReceivedListener(openNotification);
    Notifications.getLastNotificationResponseAsync()
      .then(response => {
        if (!response) return;
        openNotification(response);
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(error => {
        console.error('[push] failed to process notification response', error);
      });
    return () => subscription.remove();
  }, [router]);
}
