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

type FooterActionEvent = Readonly<{
  action: string;
}>;

export interface NativeProps extends ViewProps {
  urls?: ReadonlyArray<string>;
  types?: ReadonlyArray<string>;
  thumbnails?: ReadonlyArray<string>;
  dims?: ReadonlyArray<string>;
  itemKeys?: ReadonlyArray<string>;
  sessionId?: string;
  noteBytes?: ReadonlyArray<Int32>;
  relays?: ReadonlyArray<string>;
  currentUserPubkey?: string;
  optimisticReactionNonce?: WithDefault<Int32, 0>;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  avatarBackgroundColor?: string;
  tintColor?: string;
  primaryColor?: string;
  accentColor?: string;
  zoomBackgroundColor?: string;
  onNativeRoute?: DirectEventHandler<NativeRouteEvent>;
  onNativeAction?: DirectEventHandler<FooterActionEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'NativeMediaViewer',
) as HostComponent<NativeProps>;
