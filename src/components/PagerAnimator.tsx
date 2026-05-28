import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {StyleSheet, View, useWindowDimensions} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {scheduleOnRN} from 'react-native-worklets';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {useRenderTrace} from '../debug/renderTrace';

export type PagerPresentation = 'modal' | 'sub';

type PagerAnimatorProps<T> = {
  dismissProgress: SharedValue<number>;
  getKey: (item: T, index: number) => string;
  getPresentation: (item: T) => PagerPresentation;
  onCloseTop: () => void;
  renderItem: (params: {
    close: () => void;
    isTop: boolean;
    item: T;
  }) => React.ReactNode;
  stack: T[];
  stackDepth: SharedValue<number>;
};

type PagerCardProps<T> = {
  animatedStackLength: SharedValue<number>;
  dismissProgress: SharedValue<number>;
  gestureX: SharedValue<number>;
  gestureY: SharedValue<number>;
  index: number;
  isTop: boolean;
  item: T;
  onRequestClose: () => void;
  presentation: PagerPresentation;
  presentations: PagerPresentation[];
  renderItem: PagerAnimatorProps<T>['renderItem'];
  stackLength: number;
};

const ENTER_DURATION = 220;
const EXIT_DURATION = 180;

function timing(value: number, duration = ENTER_DURATION) {
  'worklet';
  return withTiming(value, {duration});
}

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.max(min, Math.min(max, value));
}

export function PagerAnimator<T>({
  dismissProgress,
  getKey,
  getPresentation,
  onCloseTop,
  renderItem,
  stack,
  stackDepth,
}: PagerAnimatorProps<T>) {
  const {height, width} = useWindowDimensions();
  const previousStackLengthRef = useRef(stack.length);
  const previousStackKeyRef = useRef('');
  const animatedStackLength = useSharedValue(stack.length);
  const gestureX = useSharedValue(0);
  const gestureY = useSharedValue(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);
  const stackKey = useMemo(
    () => stack.map((item, index) => getKey(item, index)).join('|'),
    [getKey, stack],
  );

  const finishClose = useCallback(() => {
    closeTimerRef.current = null;
    closingRef.current = false;
    onCloseTop();
  }, [onCloseTop]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (
      stack.length === previousStackLengthRef.current &&
      stackKey === previousStackKeyRef.current
    ) {
      return;
    }

    const previousStackLength = previousStackLengthRef.current;
    previousStackLengthRef.current = stack.length;
    previousStackKeyRef.current = stackKey;
    closingRef.current = false;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }

    gestureX.value = 0;
    gestureY.value = 0;
    dismissProgress.value = 0;

    if (stack.length > previousStackLength) {
      animatedStackLength.value = previousStackLength;
      animatedStackLength.value = timing(stack.length);
      stackDepth.value = timing(stack.length);
      return;
    }

    animatedStackLength.value = stack.length;
    stackDepth.value = stack.length;
  }, [
    animatedStackLength,
    dismissProgress,
    getKey,
    gestureX,
    gestureY,
    stack,
    stackKey,
    stack.length,
    stackDepth,
  ]);

  const topPresentation =
    stack.length > 0 ? getPresentation(stack[stack.length - 1]) : 'sub';
  const presentations = useMemo(
    () => stack.map(item => getPresentation(item)),
    [getPresentation, stack],
  );

  useRenderTrace('PagerAnimator', {
    stackKey,
    stackLength: stack.length,
    topPresentation,
    width,
  });

  const closeTop = useCallback(() => {
    if (closingRef.current || stack.length === 0) return;
    closingRef.current = true;
    const currentTopPresentation = topPresentation;
    if (currentTopPresentation === 'sub') {
      gestureX.value = timing(width, EXIT_DURATION);
      dismissProgress.value = timing(1, EXIT_DURATION);
    } else {
      gestureY.value = timing(height, EXIT_DURATION);
      dismissProgress.value = timing(1, EXIT_DURATION);
    }
    animatedStackLength.value = timing(Math.max(0, stack.length - 1), EXIT_DURATION);
    stackDepth.value = timing(Math.max(0, stack.length - 1), EXIT_DURATION);
    closeTimerRef.current = setTimeout(finishClose, EXIT_DURATION);
  }, [
    animatedStackLength,
    dismissProgress,
    finishClose,
    gestureX,
    gestureY,
    height,
    stack.length,
    stackDepth,
    topPresentation,
    width,
  ]);

  const closeTopFromGesture = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    finishClose();
  }, [finishClose]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(stack.length > 0)
        .activeOffsetX(topPresentation === 'sub' ? [-9999, 8] : [-9999, 9999])
        .activeOffsetY(topPresentation === 'modal' ? [-9999, 8] : [-9999, 9999])
        .failOffsetY(topPresentation === 'sub' ? [-16, 16] : [-9999, 9999])
        .failOffsetX(topPresentation === 'modal' ? [-16, 16] : [-9999, 9999])
        .onUpdate(event => {
          if (topPresentation === 'sub') {
            const nextX = Math.max(0, event.translationX);
            gestureX.value = nextX;
            dismissProgress.value = Math.max(0, Math.min(nextX / width, 1));
            return;
          }

          const nextY = Math.max(0, event.translationY);
          gestureY.value = nextY;
          dismissProgress.value = Math.max(0, Math.min(nextY / height, 1));
        })
        .onEnd(event => {
          const shouldClose =
            topPresentation === 'sub'
              ? event.translationX > 96 || event.velocityX > 600
              : event.translationY > 140 || event.velocityY > 650;

          if (shouldClose) {
            if (topPresentation === 'sub') {
              gestureX.value = timing(width, EXIT_DURATION);
            } else {
              gestureY.value = timing(height, EXIT_DURATION);
            }
            dismissProgress.value = timing(1, EXIT_DURATION);
            animatedStackLength.value = withTiming(
              Math.max(0, stack.length - 1),
              {duration: EXIT_DURATION},
              finished => {
                if (finished) {
                  scheduleOnRN(closeTopFromGesture);
                }
              },
            );
            stackDepth.value = timing(Math.max(0, stack.length - 1), EXIT_DURATION);
            return;
          }

          gestureX.value = timing(0);
          gestureY.value = timing(0);
          dismissProgress.value = timing(0);
        }),
    [
      animatedStackLength,
      dismissProgress,
      gestureX,
      gestureY,
      height,
      closeTopFromGesture,
      stack.length,
      stackDepth,
      topPresentation,
      width,
    ],
  );

  if (!stack.length) return null;

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View style={styles.container} pointerEvents="box-none">
        {stack.map((item, index) => (
          <PagerCard
            key={getKey(item, index)}
            animatedStackLength={animatedStackLength}
            dismissProgress={dismissProgress}
            gestureX={gestureX}
            gestureY={gestureY}
            index={index}
            isTop={index === stack.length - 1}
            item={item}
            onRequestClose={closeTop}
            presentation={getPresentation(item)}
            presentations={presentations}
            renderItem={renderItem}
            stackLength={stack.length}
          />
        ))}
      </Animated.View>
    </GestureDetector>
  );
}

function PagerCard<T>({
  animatedStackLength,
  dismissProgress,
  gestureX,
  gestureY,
  index,
  isTop,
  item,
  onRequestClose,
  presentation,
  presentations,
  renderItem,
  stackLength,
}: PagerCardProps<T>) {
  const {height, width} = useWindowDimensions();

  useRenderTrace(`PagerCard:${index}`, {
    index,
    isTop,
    presentation,
    stackLength,
    width,
  });

  const style = useAnimatedStyle(() => {
    const isSub = presentation === 'sub';
    const isTopCard = index === stackLength - 1;
    const enterOffset = clamp(index + 1 - animatedStackLength.value, 0, 1);
    let subDepth = 0;
    let modalDepth = 0;

    for (let stackIndex = index + 1; stackIndex < stackLength; stackIndex += 1) {
      const progress = clamp(animatedStackLength.value - stackIndex, 0, 1);
      if (presentations[stackIndex] === 'sub') {
        subDepth += progress;
      } else {
        modalDepth += progress;
      }
    }

    const topPresentation = presentations[stackLength - 1] ?? 'sub';
    if (!isTopCard && topPresentation === 'sub') {
      subDepth = Math.max(0, subDepth - dismissProgress.value);
    }
    if (!isTopCard && topPresentation === 'modal') {
      modalDepth = Math.max(0, modalDepth - dismissProgress.value);
    }

    const xGesture = isTopCard ? gestureX.value : 0;
    const yGesture = isTopCard ? gestureY.value : 0;

    const translateX = isSub
      ? enterOffset * width - subDepth * 30 + xGesture
      : -subDepth * 30 + xGesture;
    const translateY = isSub
      ? -modalDepth * 30 + yGesture
      : enterOffset * height - modalDepth * 30 + yGesture;
    const scale =
      Math.max(0.85, 1 - subDepth * 0.05) *
      Math.max(0.85, 1 - modalDepth * 0.05);

    return {
      transform: [{translateX}, {translateY}, {scale}],
    };
  });

  return (
    <Animated.View
      pointerEvents={isTop ? 'auto' : 'none'}
      renderToHardwareTextureAndroid
      style={[styles.cardShell, style]}
    >
      <View
        collapsable={false}
        pointerEvents="box-none"
        style={presentation === 'sub' ? styles.subContent : styles.modalContent}
      >
        {renderItem({close: onRequestClose, isTop, item})}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFill,
    zIndex: 40,
  },
  cardShell: {
    ...StyleSheet.absoluteFill,
  },
  modalContent: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.24)',
  },
  subContent: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#f5f7f8',
  },
});
