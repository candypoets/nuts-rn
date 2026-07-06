import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {WithDefault} from 'react-native/Libraries/Types/CodegenTypes';

export interface NativeProps extends ViewProps {
  pubkey?: string;
  query?: WithDefault<boolean, true>;
  backgroundColor?: string;
  borderColor?: string;
}

export default codegenNativeComponent<NativeProps>(
  'NativeAvatar',
) as HostComponent<NativeProps>;
