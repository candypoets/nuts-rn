import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

export interface NativeProps extends ViewProps {
  noteId?: string;
  noteBytes?: ReadonlyArray<Int32>;
  contextBytes?: ReadonlyArray<Int32>;
  relays?: ReadonlyArray<string>;
  visible?: WithDefault<boolean, true>;
  footer?: WithDefault<boolean, true>;
  main?: WithDefault<boolean, false>;
  showQuote?: WithDefault<boolean, true>;
  showMedia?: WithDefault<boolean, true>;
  showRoot?: WithDefault<boolean, true>;
  threadCard?: WithDefault<boolean, false>;
  disableOpen?: WithDefault<boolean, false>;
  depth?: WithDefault<Int32, 0>;
  leading?: WithDefault<boolean, false>;
  tailing?: WithDefault<boolean, false>;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  baseContentColor?: string;
  cardBackgroundColor?: string;
  borderColor?: string;
  accentColor?: string;
}

export default codegenNativeComponent<NativeProps>(
  'NativeNote',
) as HostComponent<NativeProps>;
