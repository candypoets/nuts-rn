import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

export interface NativeProps extends ViewProps {
  noteBytes?: ReadonlyArray<Int32>;
  relays?: ReadonlyArray<string>;
  currentUserPubkey?: string;
  visible?: WithDefault<boolean, true>;
  main?: WithDefault<boolean, false>;
  zoom?: WithDefault<boolean, false>;
  tintColor?: string;
  primaryColor?: string;
  accentColor?: string;
  zoomBackgroundColor?: string;
}

export default codegenNativeComponent<NativeProps>(
  'NativeNoteFooter',
) as HostComponent<NativeProps>;
