import React, {useEffect, useRef} from 'react';
import {StyleSheet, useWindowDimensions, View} from 'react-native';
import PagerView, {
  type PagerViewOnPageScrollEvent,
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import {markSwipeGestureEnd} from './notes/press';

export const SWIPE_SPRING = {
  damping: 28,
  stiffness: 220,
  mass: 0.9,
};

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
  const pagerRef = useRef<PagerView>(null);
  const virtualIndex = useSharedValue(activeIndex);
  const selectedIndexRef = useRef(activeIndex);

  useEffect(() => {
    selectedIndexRef.current = activeIndex;
    virtualIndex.value = withSpring(activeIndex, SWIPE_SPRING);
    pagerRef.current?.setPageWithoutAnimation(activeIndex);
  }, [activeIndex, virtualIndex]);

  const handlePageScroll = (event: PagerViewOnPageScrollEvent) => {
    const {position, offset} = event.nativeEvent;
    virtualIndex.value = position + offset;
  };

  const handlePageSelected = (event: PagerViewOnPageSelectedEvent) => {
    const index = event.nativeEvent.position;
    if (index !== selectedIndexRef.current) {
      markSwipeGestureEnd();
    }
    selectedIndexRef.current = index;
    virtualIndex.value = withSpring(index, SWIPE_SPRING);
    onIndexChange(index);
  };

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
    <Animated.View style={[styles.mainPager, mainStyle]}>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={activeIndex}
        scrollEnabled={enabled}
        onPageScroll={handlePageScroll}
        onPageSelected={handlePageSelected}
      >
        {Array.from({length: pageCount}, (_, index) => (
          <View key={labels[index] ?? String(index)} style={styles.page}>
            {renderPage({
              index,
              width,
              virtualIndex,
              isActive: index === activeIndex,
            })}
          </View>
        ))}
      </PagerView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mainPager: {
    flex: 1,
    overflow: 'hidden',
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});
