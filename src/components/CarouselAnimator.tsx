import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Dimensions, PanResponder, Pressable, StyleSheet, View} from 'react-native';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

export const SWIPE_SPRING = {
  damping: 28,
  stiffness: 220,
  mass: 0.9,
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

type CarouselAnimatorProps = {
  pageCount: number;
  labels: string[];
  enabled?: boolean;
  stackDepth: SharedValue<number>;
  dismissProgress: SharedValue<number>;
  stackPresentation: 'flat' | 'modal' | 'sub';
  renderPage: (params: {
    index: number;
    width: number;
    virtualX: SharedValue<number>;
    isActive: boolean;
  }) => React.ReactNode;
};

export function CarouselAnimator({
  pageCount,
  labels,
  enabled = true,
  stackDepth,
  dismissProgress,
  stackPresentation,
  renderPage,
}: CarouselAnimatorProps) {
  const width = Dimensions.get('window').width;
  const [activeIndex, setActiveIndex] = useState(0);
  const virtualX = useSharedValue(0);
  const activeIndexValue = useSharedValue(activeIndex);
  const activeIndexRef = useRef(activeIndex);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    activeIndexValue.value = activeIndex;
  }, [activeIndex, activeIndexValue]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const navigateTo = (index: number) => {
    const next = clamp(index, 0, pageCount - 1);
    setActiveIndex(next);
    activeIndexRef.current = next;
    activeIndexValue.value = next;
    virtualX.value = withSpring(next * width, SWIPE_SPRING);
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          enabledRef.current &&
          Math.abs(gesture.dx) > 8 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_, gesture) => {
          if (!enabledRef.current) return;
          const current = activeIndexRef.current;
          const maxDelta = current * width;
          const minDelta = -(pageCount - 1 - current) * width;
          let constrained = gesture.dx;
          if (gesture.dx > maxDelta)
            constrained = maxDelta + (gesture.dx - maxDelta) * 0.3;
          if (gesture.dx < minDelta)
            constrained = minDelta + (gesture.dx - minDelta) * 0.3;
          virtualX.value = current * width - constrained;
        },
        onPanResponderRelease: (_, gesture) => {
          if (!enabledRef.current) return;
          const current = activeIndexRef.current;
          const threshold = width / 3;
          const velocityThreshold = 0.5;
          const maxIndex = pageCount - 1;
          let target = current;
          if (
            Math.abs(gesture.dx) > threshold ||
            Math.abs(gesture.vx) > velocityThreshold
          ) {
            if (gesture.dx > 0) target = current - 1;
            if (gesture.dx < 0) target = current + 1;
          }
          target = Math.max(0, Math.min(maxIndex, target));
          activeIndexRef.current = target;
          activeIndexValue.value = target;
          setActiveIndex(target);
          virtualX.value = withSpring(target * width, SWIPE_SPRING);
        },
      }),
    [activeIndexValue, pageCount, virtualX, width],
  );

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
      <Animated.View style={[styles.mainPager, mainStyle]} {...panResponder.panHandlers}>
        {Array.from({length: pageCount}, (_, index) =>
          renderPage({
            index,
            width,
            virtualX,
            isActive: index === activeIndex,
          }),
        )}
      </Animated.View>
      <View style={styles.carouselProgress}>
        {labels.map((label, index) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            style={styles.progressButton}
            onPress={() => navigateTo(index)}
          >
            <ProgressBar index={index} virtualX={virtualX} width={width} />
          </Pressable>
        ))}
      </View>
    </>
  );
}

function ProgressBar({
  index,
  virtualX,
  width,
}: {
  index: number;
  virtualX: SharedValue<number>;
  width: number;
}) {
  const style = useAnimatedStyle(() => {
    const ratio = 1 / (Math.abs(virtualX.value - index * width) / width + 1);
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
