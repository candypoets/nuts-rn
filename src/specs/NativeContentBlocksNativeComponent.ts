import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  Int32,
  WithDefault,
} from 'react-native/Libraries/Types/CodegenTypes';

export interface NativeProps extends ViewProps {
  noteId?: string;
  noteBytes?: ReadonlyArray<Int32>;
  relays?: ReadonlyArray<string>;
  visible?: WithDefault<boolean, true>;
  main?: WithDefault<boolean, false>;
  showQuote?: WithDefault<boolean, true>;
  showMedia?: WithDefault<boolean, true>;
  forceFullContent?: WithDefault<boolean, false>;
  depth?: WithDefault<Int32, 0>;
  primaryTextColor?: string;
  secondaryTextColor?: string;
  baseContentColor?: string;
  borderColor?: string;
  accentColor?: string;
}

export default codegenNativeComponent<NativeProps>(
  'NativeContentBlocks',
) as HostComponent<NativeProps>;
