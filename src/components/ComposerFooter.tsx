import React, {useCallback} from 'react';
import {Platform, Pressable, StyleSheet, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {BlurView} from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import {Plus} from 'lucide-react-native';

import type {RootStackParamList} from '../navigation/types';
import {useAppTheme} from '../theme';

type ComposerFooterProps = {
  bottomOffset?: number;
  floating?: boolean;
  visible?: boolean;
};

export function ComposerFooter({
  bottomOffset = 0,
  floating = true,
  visible = true,
}: ComposerFooterProps) {
  const theme = useAppTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const openPost = useCallback(() => navigation.navigate('Post'), [navigation]);
  const darkMaterial =
    theme.id === 'nightsky' ||
    theme.id === 'matteblack' ||
    theme.id === 'downfox';
  const canUseLiquidGlass =
    Platform.OS === 'ios' &&
    isLiquidGlassAvailable() &&
    isGlassEffectAPIAvailable();
  const contentColor = canUseLiquidGlass
    ? theme.colors.primary
    : darkMaterial
      ? '#ffffff'
      : theme.button.primary.text;

  if (!visible) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[
        floating ? styles.floatingWrap : styles.embeddedWrap,
        {
          bottom: floating ? bottomOffset : undefined,
          marginBottom: floating ? undefined : bottomOffset,
          paddingBottom: 0,
        },
      ]}
    >
      <Pressable
        hitSlop={8}
        onPress={openPost}
        style={[
          styles.button,
          canUseLiquidGlass && styles.glassButton,
          {
            backgroundColor:
              canUseLiquidGlass
                ? 'transparent'
                : Platform.OS === 'ios'
                  ? `${theme.colors.primary}D9`
                  : `${theme.colors.primary}E6`,
            borderColor: canUseLiquidGlass
              ? `${theme.colors.primaryContent}38`
              : darkMaterial
                ? '#8ff7df'
                : theme.button.primary.border,
          },
        ]}
      >
        {canUseLiquidGlass ? (
          <GlassView
            colorScheme="dark"
            glassEffectStyle="regular"
            isInteractive
            style={styles.glassSurface}
          >
            <Plus size={29} color={contentColor} strokeWidth={2.5} />
          </GlassView>
        ) : (
          <BlurView
            intensity={Platform.OS === 'ios' ? 32 : 28}
            tint={Platform.OS === 'ios' && !darkMaterial ? 'light' : 'dark'}
            style={[
              styles.blur,
              {
                backgroundColor:
                  Platform.OS === 'ios'
                    ? `${theme.colors.primary}73`
                    : `${theme.colors.primary}66`,
              },
            ]}
          >
            <Plus size={28} color={contentColor} strokeWidth={2.5} />
          </BlurView>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  embeddedWrap: {
    alignItems: 'flex-end',
    elevation: 24,
    paddingHorizontal: 16,
    zIndex: 50,
  },
  floatingWrap: {
    alignItems: 'flex-end',
    elevation: 24,
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    zIndex: 50,
  },
  button: {
    borderRadius: 999,
    borderWidth: 1,
    elevation: 18,
    overflow: 'hidden',
    shadowColor: '#1fb092',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.82,
    shadowRadius: 28,
  },
  glassButton: {
    borderWidth: 1,
    shadowColor: '#020617',
    shadowOpacity: 0.34,
    shadowRadius: 24,
  },
  blur: {
    alignItems: 'center',
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
  glassSurface: {
    alignItems: 'center',
    height: 58,
    justifyContent: 'center',
    width: 58,
  },
});
