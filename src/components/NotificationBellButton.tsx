import React, {memo, useCallback} from 'react';
import {Pressable, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Bell} from 'lucide-react-native';

import type {RootStackParamList} from '../navigation/types';
import {useAppStore} from '../stores';

type NotificationBellButtonProps = {
  className?: string;
};

export const NotificationBellButton = memo(function NotificationBellButton({
  className = 'h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50',
}: NotificationBellButtonProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const missed = useAppStore(state => state.missedNotifications);

  const handlePress = useCallback(() => {
    navigation.navigate('Notifications');
  }, [navigation]);

  return (
    <Pressable className={className} hitSlop={12} onPress={handlePress}>
      <Bell size={19} color="#17212b" strokeWidth={2.2} />
      {missed > 0 ? (
        <View className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full border border-white bg-emerald-500" />
      ) : null}
    </Pressable>
  );
});
