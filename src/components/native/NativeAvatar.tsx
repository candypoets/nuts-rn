import React from 'react';
import {StyleSheet} from 'react-native';
import NativeAvatarComponent from '../../specs/NativeAvatarNativeComponent';
import {useAppTheme} from '../../theme';

type Props = {
  pubkey: string;
  query?: boolean;
  initials?: string;
  avatarColor?: string;
  style?: object;
};

export function NativeAvatar({pubkey, query = true, initials, avatarColor, style}: Props) {
  const theme = useAppTheme();
  return (
    <NativeAvatarComponent
      pubkey={pubkey}
      query={query}
      backgroundColor={theme.colors.base200}
      borderColor={theme.colors.base200}
      initials={initials}
      avatarColor={avatarColor}
      style={[styles.root, style]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
});
