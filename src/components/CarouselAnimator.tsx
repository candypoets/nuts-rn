import React, {useEffect, useRef} from 'react';
import {Pressable, StyleSheet, useWindowDimensions, View} from 'react-native';
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
  withTiming,
} from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {markSwipeGestureEnd} from './notes/press';

export const SWIPE_SPRING = {
  damping: 28,
  stiffness: 220,
  mass: 0.9,
};

const FEED_TOP_SAFE_AREA_OFFSET = 14;

type CarouselAnimatorProps = {
  activeIndex: number;
  pageCount: number;
  labels: string[];
  enabled?: boolean;
  stackDepth: SharedValue<number>;
  dismissProgress: SharedValue<number>;
  stackPresentation: 'flat' | 'modal' | 'sub';
  indicatorColor?: string;
  indicatorVisible?: boolean;
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
  indicatorColor = '#ffffff',
  indicatorVisible = true,
  onIndexChange,
  renderPage,
}: CarouselAnimatorProps) {
  const {width} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView>(null);
  const virtualIndex = useSharedValue(activeIndex);
  const indicatorProgress = useSharedValue(indicatorVisible ? 1 : 0);
  const selectedIndexRef = useRef(activeIndex);
  const indicatorTop = Math.max(0, insets.top - FEED_TOP_SAFE_AREA_OFFSET);

  useEffect(() => {
    selectedIndexRef.current = activeIndex;
    virtualIndex.value = withSpring(activeIndex, SWIPE_SPRING);
    pagerRef.current?.setPageWithoutAnimation(activeIndex);
  }, [activeIndex, virtualIndex]);

  useEffect(() => {
    indicatorProgress.value = withTiming(indicatorVisible ? 1 : 0, {
      duration: 180,
    });
  }, [indicatorProgress, indicatorVisible]);

  const navigateTo = (index: number) => {
    const next = Math.max(0, Math.min(pageCount - 1, index));
    selectedIndexRef.current = next;
    virtualIndex.value = withSpring(next, SWIPE_SPRING);
    pagerRef.current?.setPage(next);
    onIndexChange(next);
  };

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

  const indicatorStyle = useAnimatedStyle(() => ({
    opacity: indicatorProgress.value,
    transform: [{translateY: (1 - indicatorProgress.value) * -8}],
  }));

  return (
    <>
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
      <View
        pointerEvents={indicatorVisible ? 'box-none' : 'none'}
        style={[styles.carouselProgress, {top: indicatorTop}]}
      >
        <Animated.View style={[styles.progressRow, indicatorStyle]}>
          {labels.map((label, index) => (
            <Pressable
              key={label}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{selected: index === activeIndex}}
              style={styles.progressButton}
              onPress={() => navigateTo(index)}
            >
              <ProgressBar
                color={indicatorColor}
                index={index}
                virtualIndex={virtualIndex}
              />
            </Pressable>
          ))}
        </Animated.View>
      </View>
    </>
  );
}

function ProgressBar({
  color,
  index,
  virtualIndex,
}: {
  color: string;
  index: number;
  virtualIndex: SharedValue<number>;
}) {
  const style = useAnimatedStyle(() => {
    const ratio = 1 / (Math.abs(virtualIndex.value - index) + 1);
    return {
      opacity: 0.3 + ratio * 0.7,
      width: 10 + ratio * 8,
    };
  });

  return <Animated.View style={[styles.progress, {backgroundColor: color}, style]} />;
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
  carouselProgress: {
    alignSelf: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    zIndex: 60,
    elevation: 60,
  },
  progressRow: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  progressButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  progress: {
    borderRadius: 999,
    height: 4,
  },
});
