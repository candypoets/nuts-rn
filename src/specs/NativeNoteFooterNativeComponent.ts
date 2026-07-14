import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  DirectEventHandler,
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

type FooterActionEvent = Readonly<{
  action: string;
}>;

export interface NativeProps extends ViewProps {
  noteBytes?: ReadonlyArray<Int32>;
  relays?: ReadonlyArray<string>;
  relayResolutionPending?: WithDefault<boolean, false>;
  currentUserPubkey?: string;
  optimisticReactionNonce?: WithDefault<Int32, 0>;
  visible?: WithDefault<boolean, true>;
  main?: WithDefault<boolean, false>;
  zoom?: WithDefault<boolean, false>;
  tintColor?: string;
  primaryColor?: string;
  accentColor?: string;
  zoomBackgroundColor?: string;
  onNativeAction?: DirectEventHandler<FooterActionEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'NativeNoteFooter',
) as HostComponent<NativeProps>;
