import React, {useEffect} from 'react';
import {Pressable, StyleSheet, useWindowDimensions, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {useRenderTrace} from '../debug/renderTrace';

export const SWIPE_SPRING = {
  damping: 28,
  stiffness: 220,
  mass: 0.9,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type CarouselAnimatorProps = {
  activeIndex: number;
  pageCount: number;
  labels: string[];
  enabled?: boolean;
  stackDepth: SharedValue<number>;
  dismissProgress: SharedValue<number>;
  stackPresentation: 'flat' | 'modal' | 'sub';
  onIndexChange: (index: number) => void;
  renderPage: (params: {
    index: number;
    width: number;
    virtualIndex: SharedValue<number>;
    isActive: boolean;
  }) => React.ReactNode;
};

export function CarouselAnimator({
  activeIndex,
  pageCount,
  labels,
  enabled = true,
  stackDepth,
  dismissProgress,
  stackPresentation,
  onIndexChange,
  renderPage,
}: CarouselAnimatorProps) {
  const {width} = useWindowDimensions();
  const virtualIndex = useSharedValue(activeIndex);
  const activeIndexValue = useSharedValue(activeIndex);
  const gestureStartIndex = useSharedValue(activeIndex);
  const enabledValue = useSharedValue(enabled);

  useRenderTrace('CarouselAnimator', {
    activeIndex,
    enabled,
    pageCount,
    stackPresentation,
    width,
  });

  useEffect(() => {
    activeIndexValue.value = activeIndex;
    virtualIndex.value = withSpring(activeIndex, SWIPE_SPRING);
  }, [activeIndex, activeIndexValue, virtualIndex]);

  useEffect(() => {
    enabledValue.value = enabled;
  }, [enabled, enabledValue]);

  const navigateTo = (index: number) => {
    const next = clamp(index, 0, pageCount - 1);
    activeIndexValue.value = next;
    virtualIndex.value = withSpring(next, SWIPE_SPRING);
    onIndexChange(next);
  };

  const panGesture = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX([-8, 8])
    .failOffsetY([-8, 8])
    .onBegin(() => {
      gestureStartIndex.value = activeIndexValue.value;
    })
    .onUpdate(event => {
      if (!enabledValue.value || width <= 0) return;
      const current = activeIndexValue.value;
      const maxDelta = current * width;
      const minDelta = -(pageCount - 1 - current) * width;
      let constrained = event.translationX;
      if (event.translationX > maxDelta) {
        constrained = maxDelta + (event.translationX - maxDelta) * 0.3;
      }
      if (event.translationX < minDelta) {
        constrained = minDelta + (event.translationX - minDelta) * 0.3;
      }
      virtualIndex.value = gestureStartIndex.value - constrained / width;
    })
    .onEnd(event => {
      if (!enabledValue.value || width <= 0) return;
      const current = activeIndexValue.value;
      const threshold = width / 3;
      const velocityThreshold = 500;
      let target = current;

      if (
        Math.abs(event.translationX) > threshold ||
        Math.abs(event.velocityX) > velocityThreshold
      ) {
        if (event.translationX > 0) target = current - 1;
        if (event.translationX < 0) target = current + 1;
      }

      target = Math.max(0, Math.min(pageCount - 1, target));
      activeIndexValue.value = target;
      virtualIndex.value = withSpring(target, SWIPE_SPRING);
      runOnJS(onIndexChange)(target);
    });

  const mainStyle = useAnimatedStyle(() => {
    const effectiveDepth = Math.max(0, stackDepth.value - dismissProgress.value);
    return {
      transform: [
        {
          translateX:
            stackPresentation === 'sub'
              ? -interpolate(
                  effectiveDepth,
                  [0, 1],
                  [0, width * 0.2],
                  Extrapolation.CLAMP,
                )
              : 0,
        },
        {
          translateY:
            stackPresentation === 'modal'
              ? interpolate(effectiveDepth, [0, 1], [0, 30], Extrapolation.CLAMP)
              : 0,
        },
        {
          scale: interpolate(
            effectiveDepth,
            [0, 1],
            [1, stackPresentation === 'modal' ? 0.94 : 0.92],
            Extrapolation.CLAMP,
          ),
        },
      ],
      opacity:
        stackPresentation === 'modal'
          ? 1
          : interpolate(effectiveDepth, [0, 1], [1, 0.72], Extrapolation.CLAMP),
    };
  });

  return (
    <>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.mainPager, mainStyle]}>
          {Array.from({length: pageCount}, (_, index) =>
            renderPage({
              index,
              width,
              virtualIndex,
              isActive: index === activeIndex,
            }),
          )}
        </Animated.View>
      </GestureDetector>
      <View style={styles.carouselProgress}>
        {labels.map((label, index) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={styles.progressButton}
            onPress={() => navigateTo(index)}
          >
            <ProgressBar index={index} virtualIndex={virtualIndex} />
          </Pressable>
        ))}
      </View>
    </>
  );
}

function ProgressBar({
  index,
  virtualIndex,
}: {
  index: number;
  virtualIndex: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const ratio = 1 / (Math.abs(virtualIndex.value - index) + 1);
    return {
      opacity: 0.3 + ratio * 0.7,
      transform: [{scaleX: 0.75 + ratio * 0.5}],
    };
  });

  return <Animated.View style={[styles.progress, style]} />;
}

const styles = StyleSheet.create({
  mainPager: {
    flex: 1,
    overflow: 'hidden',
  },
  carouselProgress: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    left: '25%',
    position: 'absolute',
    right: '25%',
    top: 8,
    zIndex: 20,
  },
  progressButton: {
    flex: 1,
    paddingVertical: 10,
  },
  progress: {
    backgroundColor: '#17212b',
    borderRadius: 2,
    height: 4,
  },
});
