import type { NostrManagerLike } from '@candypoets/nipworker';
import {
  ReactNativeBackend,
  hasReactNativeModule,
  setManager,
} from '@candypoets/nipworker/react-native';

let sharedManager: NostrManagerLike | null = null;
let initialized = false;

/**
 * Lazily creates and caches the app-wide nostr manager.
 *
 * This must run before Swift/Kotlin native components use Nipworker hooks.
 * The RN manager initializes the Rust runtime that native components borrow.
 *
 * Returns null when the native module is unavailable (e.g. jest) or when
 * initialization fails.
 */
export function getSharedNostrManager(): NostrManagerLike | null {
  if (initialized) {
    return sharedManager;
  }
  initialized = true;

  try {
    if (!hasReactNativeModule()) {
      return null;
    }

    const manager = new ReactNativeBackend();
    setManager(manager);
    sharedManager = manager;
  } catch (error) {
    console.warn('[app] failed to initialize nostr manager', error);
  }

  return sharedManager;
}
