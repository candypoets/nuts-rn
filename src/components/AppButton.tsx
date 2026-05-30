import React from 'react';
import { Pressable, Text } from 'react-native';

import { type ButtonTone, useAppTheme } from '../theme';

type AppButtonProps = {
  title: string;
  tone?: ButtonTone;
  disabled?: boolean;
  onPress?: () => void;
  className?: string;
};

export function AppButton({
  title,
  tone = 'primary',
  disabled = false,
  onPress,
  className = '',
}: AppButtonProps) {
  const theme = useAppTheme();
  const palette = disabled ? theme.button.disabled : theme.button[tone];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      className={`items-center justify-center rounded-lg border py-3 ${className}`}
      disabled={disabled}
      onPress={onPress}
      style={{
        backgroundColor: palette.background,
        borderColor: palette.border,
      }}
    >
      <Text
        className="text-base font-bold"
        style={{ color: palette.text }}
      >
        {title}
      </Text>
    </Pressable>
  );
}
