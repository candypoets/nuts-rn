import React, {memo, useEffect} from 'react';
import {View} from 'react-native';
import type {ConnectionStatus} from '@candypoets/nipworker';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import {useSendStatusStore} from '../stores';

function statusColor(status: ConnectionStatus) {
  switch (status.status()?.toString()) {
    case 'true':
      return '#22c55e';
    case 'false':
      return '#ef4444';
    default:
      return '#d1d5db';
  }
}

const StatusDot = memo(function StatusDot({
  status,
}: {
  status: ConnectionStatus;
}) {
  const color = statusColor(status);
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.set(
      withTiming(1, {duration: 220, reduceMotion: ReduceMotion.System}),
    );
    const timeout = setTimeout(() => {
      progress.set(
        withTiming(2, {duration: 220, reduceMotion: ReduceMotion.System}),
      );
    }, 5000);
    return () => clearTimeout(timeout);
  }, [progress]);

  const style = useAnimatedStyle(() => {
    const currentProgress = progress.get();
    const entering = currentProgress <= 1;
    const offset = entering
      ? (1 - currentProgress) * 1000
      : -(currentProgress - 1) * 1000;
    return {
      backgroundColor: color,
      opacity:
        currentProgress <= 1
          ? 0.5 + currentProgress * 0.5
          : 2 - currentProgress,
      transform: [{translateY: offset}],
    };
  }, [color]);

  return <Animated.View className="h-2.5 w-2.5 rounded-full" style={style} />;
});

export function SendStatuses() {
  const sendStatuses = useSendStatusStore(state => state.sendStatuses);
  const entries = Object.entries(sendStatuses);

  if (!entries.length) return null;

  return (
    <View
      pointerEvents="none"
      className="absolute bottom-0 left-5 top-0 z-50 justify-center gap-3"
    >
      {entries.map(([sendId, connectionStatus]) => (
        <View key={sendId} className="gap-3">
          {Object.entries(connectionStatus).map(([relay, status]) => (
            <StatusDot key={`${sendId}:${relay}`} status={status} />
          ))}
        </View>
      ))}
    </View>
  );
}
