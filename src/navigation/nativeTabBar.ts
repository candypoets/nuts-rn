import {NativeModules, Platform} from 'react-native';

type NativeTabBarControllerModule = {
  configureCompactAppearance?: () => void;
  setHidden?: (hidden: boolean, animated: boolean) => void;
  diagnoseScrollViews?: () => void;
};

const nativeTabBarController =
  Platform.OS === 'ios'
    ? (NativeModules.NativeTabBarController as NativeTabBarControllerModule | undefined)
    : undefined;

let hidden = false;

export function configureNativeTabBarCompactAppearance() {
  nativeTabBarController?.configureCompactAppearance?.();
}

export function setNativeTabBarVisible(visible: boolean, animated = true) {
  if (!nativeTabBarController?.setHidden) return;

  const nextHidden = !visible;
  if (hidden === nextHidden) return;
  hidden = nextHidden;
  nativeTabBarController.setHidden(nextHidden, animated);
}

export function diagnoseNativeTabBarScrollViews() {
  nativeTabBarController?.diagnoseScrollViews?.();
}
