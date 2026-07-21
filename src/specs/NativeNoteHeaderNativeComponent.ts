import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  DirectEventHandler,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

type NativeRouteEvent = Readonly<{
  route: string;
}>;

export interface NativeProps extends ViewProps {
  noteBytes?: ReadonlyArray<Int32>;
  relays?: ReadonlyArray<string>;
  visible?: WithDefault<boolean, true>;
  depth?: WithDefault<Int32, 0>;
  main?: WithDefault<boolean, false>;
  showRelays?: WithDefault<boolean, true>;
  relayCount?: WithDefault<Int32, 0>;
  relayStatuses?: ReadonlyArray<string>;
  authorPubkey?: string;
  reposterPubkey?: string;
  fallbackSubId?: string;
  nameFallback?: string;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  avatarBackgroundColor?: string;
  accentColor?: string;
  onNativeRoute?: DirectEventHandler<NativeRouteEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'NativeNoteHeader',
) as HostComponent<NativeProps>;
