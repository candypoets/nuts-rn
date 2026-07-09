import type { StyleProp, ViewStyle } from 'react-native';
import type { ParsedEvent } from '@candypoets/nipworker';
import type { ImageGridLink } from '../notes/ImageGrid';

export const isNativeMediaViewerAvailable = false;

type Props = {
  links: ImageGridLink[];
  note?: ParsedEvent;
  relays?: string[];
  containerWidth?: number;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

export function NativeMediaViewer(_props: Props) {
  return null;
}
