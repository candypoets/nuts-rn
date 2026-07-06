import React from 'react';
import {StyleSheet} from 'react-native';
import NativeAvatarComponent from '../../specs/NativeAvatarNativeComponent';
import {useAppTheme} from '../../theme';

type Props = {
  pubkey: string;
  query?: boolean;
  style?: object;
};

export function NativeAvatar({pubkey, query = true, style}: Props) {
  const theme = useAppTheme();
  return (
    <NativeAvatarComponent
      pubkey={pubkey}
      query={query}
      backgroundColor={theme.colors.base200}
      borderColor={theme.colors.base200}
      style={[styles.root, style]}
    />
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
});
