import type {HostComponent, ViewProps} from 'react-native';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import type {
  DirectEventHandler,
  Double,
} from 'react-native/Libraries/Types/CodegenTypes';

type HeightChangeEvent = Readonly<{
  height: Double;
}>;

type NativeRouteEvent = Readonly<{
  route: string;
}>;

export interface NativeProps extends ViewProps {
  url?: string;
  text?: string;
  baseContentColor?: string;
  secondaryTextColor?: string;
  cardBackgroundColor?: string;
  borderColor?: string;
  onHeightChange?: DirectEventHandler<HeightChangeEvent>;
  onNativeRoute?: DirectEventHandler<NativeRouteEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'NativeLinkPreview',
) as HostComponent<NativeProps>;
