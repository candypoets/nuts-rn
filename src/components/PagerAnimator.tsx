import React, {useEffect, useRef} from 'react';
import {StyleSheet, useWindowDimensions} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {SWIPE_SPRING} from './CarouselAnimator';

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
  depthFromTop: number;
  dismissProgress: SharedValue<number>;
  isTop: boolean;
  item: T;
  onCloseTop: () => void;
  presentation: PagerPresentation;
  renderItem: PagerAnimatorProps<T>['renderItem'];
};

export function PagerAnimator<T>({
  dismissProgress,
  getKey,
  getPresentation,
  onCloseTop,
  renderItem,
  stack,
  stackDepth,
}: PagerAnimatorProps<T>) {
  const previousStackLengthRef = useRef(stack.length);

  useEffect(() => {
    const previousStackLength = previousStackLengthRef.current;
    previousStackLengthRef.current = stack.length;

    if (stack.length < previousStackLength) {
      stackDepth.value = stack.length;
      dismissProgress.value = 0;
      return;
    }

    stackDepth.value = withTiming(stack.length, {duration: 220});
  }, [dismissProgress, stack.length, stackDepth]);

  if (!stack.length) return null;

  return (
    <>
      {stack.map((item, index) => (
        <PagerCard
          key={getKey(item, index)}
          depthFromTop={stack.length - 1 - index}
          dismissProgress={dismissProgress}
          isTop={index === stack.length - 1}
          item={item}
          onCloseTop={onCloseTop}
          presentation={getPresentation(item)}
          renderItem={renderItem}
        />
      ))}
    </>
  );
}

function PagerCard<T>({
  depthFromTop,
  dismissProgress,
  isTop,
  item,
  onCloseTop,
  presentation,
  renderItem,
}: PagerCardProps<T>) {
  const {height, width} = useWindowDimensions();
  const enter = useSharedValue(0);
  const animatedDepth = useSharedValue(depthFromTop);
  const dismissX = useSharedValue(0);
  const dismissY = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(1, {duration: 220});
  }, [enter]);

  useEffect(() => {
    if (depthFromTop < animatedDepth.value && dismissProgress.value > 0) {
      animatedDepth.value = depthFromTop;
      return;
    }
    animatedDepth.value = withTiming(depthFromTop, {duration: 220});
  }, [animatedDepth, depthFromTop, dismissProgress]);

  useEffect(() => {
    if (!isTop) return;
    dismissX.value = withSpring(0, SWIPE_SPRING);
    dismissY.value = withSpring(0, SWIPE_SPRING);
    dismissProgress.value = withSpring(0, SWIPE_SPRING);
    enter.value = withTiming(1, {duration: 120});
  }, [dismissProgress, dismissX, dismissY, enter, isTop]);

  const close = () => {
    dismissProgress.value = withTiming(1, {duration: 180});
    if (presentation === 'sub') {
      dismissX.value = withTiming(width, {duration: 180});
    } else {
      dismissY.value = withTiming(height, {duration: 180});
    }
    enter.value = withTiming(0, {duration: 180}, () => {
      runOnJS(onCloseTop)();
    });
  };

  const panGesture = Gesture.Pan()
    .enabled(isTop)
    .activeOffsetX(presentation === 'sub' ? [-9999, 8] : [-9999, 9999])
    .activeOffsetY(presentation === 'modal' ? [-9999, 8] : [-9999, 9999])
    .onUpdate(event => {
      if (presentation === 'sub') {
        const nextX = Math.max(0, event.translationX);
        dismissX.value = nextX;
        dismissProgress.value = Math.max(0, Math.min(nextX / width, 1));
        return;
      }

      const nextY = Math.max(0, event.translationY);
      dismissY.value = nextY;
      dismissProgress.value = Math.max(0, Math.min(nextY / height, 1));
    })
    .onEnd(event => {
      const shouldClose =
        presentation === 'sub'
          ? event.translationX > 96 || event.velocityX > 600
          : event.translationY > 140 || event.velocityY > 650;

      if (shouldClose) {
        if (presentation === 'sub') {
          dismissX.value = withTiming(width, {duration: 180});
        } else {
          dismissY.value = withTiming(height, {duration: 180});
        }
        dismissProgress.value = withTiming(1, {duration: 180});
        enter.value = withTiming(0, {duration: 180}, () => {
          runOnJS(onCloseTop)();
        });
        return;
      }

      dismissX.value = withSpring(0, SWIPE_SPRING);
      dismissY.value = withSpring(0, SWIPE_SPRING);
      dismissProgress.value = withSpring(0, SWIPE_SPRING);
    });

  const style = useAnimatedStyle(() => {
    const effectiveDepth = Math.max(
      0,
      animatedDepth.value - dismissProgress.value,
    );
    const isSub = presentation === 'sub';

    return {
      opacity: enter.value * Math.max(0.45, 1 - effectiveDepth * 0.25),
      transform: [
        {
          translateX: isSub
            ? (1 - enter.value) * width - effectiveDepth * 30 + dismissX.value
            : dismissX.value,
        },
        {
          translateY: isSub
            ? dismissY.value
            : (1 - enter.value) * height + effectiveDepth * 30 + dismissY.value,
        },
        {scale: isSub ? 1 : 1 - effectiveDepth * 0.04},
      ],
    };
  });

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        pointerEvents={isTop ? 'auto' : 'none'}
        style={[
          presentation === 'sub' ? styles.subLayer : styles.modalLayer,
          style,
        ]}
      >
        {renderItem({close, isTop, item})}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  modalLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.24)',
    zIndex: 40,
  },
  subLayer: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#f5f7f8',
    zIndex: 40,
  },
});
