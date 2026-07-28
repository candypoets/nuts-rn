import React, {memo, useCallback} from 'react';
import {Pressable, View} from 'react-native';
import {useNavigation} from 'expo-router/react-navigation';
import {Bell} from 'lucide-react-native';

import type {AppNavigationProp} from '../navigation/types';
import {useAppStore} from '../stores';
import {useAppTheme} from '../theme';

type NotificationBellButtonProps = {
  className?: string;
};

export const NotificationBellButton = memo(function NotificationBellButton({
  className = 'h-9 w-9 items-center justify-center rounded-full border border-base-200 bg-base-100',
}: NotificationBellButtonProps) {
  const navigation = useNavigation<AppNavigationProp>();
  const theme = useAppTheme();
  const missed = useAppStore(state => state.missedNotifications);

  const handlePress = useCallback(() => {
    navigation.navigate('Notifications');
  }, [navigation]);

  return (
    <Pressable className={className} hitSlop={12} onPress={handlePress}>
      <Bell size={19} color={theme.colors.primaryContent} strokeWidth={2.2} />
      {missed > 0 ? (
        <View className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border border-base-100 bg-primary" />
      ) : null}
    </Pressable>
  );
});
