import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  Extrapolation,
  ReduceMotion,
  type SharedValue,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export type SegmentedTab<T extends string> = {
  id: T;
  label: string;
  count?: number;
};

type SegmentedTabsProps<T extends string> = {
  tabs: Array<SegmentedTab<T>>;
  selectedId: T;
  onSelect: (id: T) => void;
  variant?: 'underline' | 'pill';
  layout?: 'scroll' | 'equal' | 'adaptive';
  labelWeight?: 'regular' | 'medium' | 'semibold' | 'bold';
  className?: string;
  renderCount?: (count: number) => ReactNode;
  selectionProgress?: SharedValue<number>;
};

export function SegmentedTabs<T extends string>({
  tabs,
  selectedId,
  onSelect,
  variant = 'underline',
  layout = 'equal',
  labelWeight,
  className,
  renderCount,
  selectionProgress,
}: SegmentedTabsProps<T>) {
  const [tabLayouts, setTabLayouts] = useState<
    Partial<Record<T, {x: number; width: number}>>
  >({});
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const previousSelectedIdRef = useRef<T | null>(null);
  const selectedLayout = tabLayouts[selectedId];
  const pillInset = variant === 'pill' ? 1 : 0;
  const progressLayouts = tabs.map(tab => tabLayouts[tab.id]);
  const hasProgressLayouts =
    !!selectionProgress &&
    progressLayouts.length > 1 &&
    progressLayouts.every(layoutValue => !!layoutValue);
  const progressInputRange = tabs.map((_, index) => index);
  const progressXRange = progressLayouts.map(
    layoutValue => layoutValue?.x ?? 0,
  );
  const progressWidthRange = progressLayouts.map(layoutValue =>
    Math.max(0, (layoutValue?.width ?? 0) - pillInset * 2),
  );

  const handleTabLayout = useCallback((id: T, event: LayoutChangeEvent) => {
    const {x, width} = event.nativeEvent.layout;
    setTabLayouts(current => {
      const previous = current[id];
      if (
        previous &&
        Math.abs(previous.x - x) < 0.5 &&
        Math.abs(previous.width - width) < 0.5
      ) {
        return current;
      }
      return {...current, [id]: {x, width}};
    });
  }, []);

  useEffect(() => {
    if (!selectedLayout) return;
    const previousSelectedId = previousSelectedIdRef.current;
    const previousLayout =
      previousSelectedId && previousSelectedId !== selectedId
        ? tabLayouts[previousSelectedId]
        : undefined;
    const nextWidth = Math.max(0, selectedLayout.width - pillInset * 2);

    if (!previousSelectedId) {
      indicatorX.set(selectedLayout.x);
      indicatorWidth.set(nextWidth);
      previousSelectedIdRef.current = selectedId;
      return;
    }

    if (previousLayout) {
      indicatorX.set(previousLayout.x);
      indicatorWidth.set(Math.max(0, previousLayout.width - pillInset * 2));
    }

    indicatorX.set(
      withTiming(selectedLayout.x, {
        duration: 220,
        reduceMotion: ReduceMotion.System,
      }),
    );
    indicatorWidth.set(
      withTiming(nextWidth, {
        duration: 220,
        reduceMotion: ReduceMotion.System,
      }),
    );
    previousSelectedIdRef.current = selectedId;
  }, [
    indicatorWidth,
    indicatorX,
    pillInset,
    selectedId,
    selectedLayout,
    tabLayouts,
  ]);

  const indicatorStyle = useAnimatedStyle(() => {
    if (selectionProgress && hasProgressLayouts) {
      const progress = selectionProgress.get();
      return {
        transform: [
          {
            translateX: interpolate(
              progress,
              progressInputRange,
              progressXRange,
              Extrapolation.CLAMP,
            ),
          },
        ],
        width: interpolate(
          progress,
          progressInputRange,
          progressWidthRange,
          Extrapolation.CLAMP,
        ),
      };
    }

    return {
      transform: [{translateX: indicatorX.get()}],
      width: indicatorWidth.get(),
    };
  });
  const effectiveLabelWeight =
    labelWeight ?? (variant === 'pill' ? 'bold' : 'semibold');
  const labelWeightClass =
    effectiveLabelWeight === 'regular'
      ? 'font-normal'
      : effectiveLabelWeight === 'medium'
      ? 'font-medium'
      : effectiveLabelWeight === 'bold'
      ? 'font-bold'
      : 'font-semibold';

  const content = (
    <View
      className={`relative flex-row ${
        variant === 'pill'
          ? 'overflow-hidden rounded-full border border-base-200 bg-base-300'
          : ''
      } ${className ?? ''}`}
      style={layout === 'adaptive' ? styles.adaptiveContent : undefined}
    >
      <Animated.View
        className={
          variant === 'pill'
            ? 'absolute rounded-full border border-primary bg-base-200'
            : 'absolute bottom-0 left-0 h-px rounded-full bg-primary'
        }
        style={[
          variant === 'pill'
            ? {bottom: pillInset, left: pillInset, top: pillInset}
            : null,
          indicatorStyle,
        ]}
      />
      {tabs.map(tab => {
        const selected = tab.id === selectedId;
        return (
          <Pressable
            key={tab.id}
            accessibilityLabel={`${selected ? 'Selected' : 'Select'} ${
              tab.label
            }`}
            accessibilityState={{selected}}
            className={`h-9 items-center justify-center ${
              layout === 'equal'
                ? 'flex-1'
                : layout === 'scroll'
                ? 'min-w-20 px-3'
                : 'px-2'
            } ${variant === 'pill' ? 'flex-row gap-2 px-3' : 'pb-2 pt-1'}`}
            style={layout === 'adaptive' ? styles.adaptiveTab : undefined}
            onLayout={event => handleTabLayout(tab.id, event)}
            onPress={event => {
              event.stopPropagation();
              if (!selected) onSelect(tab.id);
            }}
          >
            <Text
              numberOfLines={1}
              className={`${
                variant === 'pill'
                  ? `text-xs ${labelWeightClass} uppercase`
                  : `text-base ${labelWeightClass}`
              } ${selected ? 'text-base-content' : 'text-base-content/60'}`}
            >
              {tab.label}
            </Text>
            {tab.count !== undefined
              ? renderCount?.(tab.count) ?? (
                  <View className="min-w-6 items-center rounded-full bg-base-200 px-2 py-0.5">
                    <Text className="text-xs font-bold text-primary-content">
                      {tab.count}
                    </Text>
                  </View>
                )
              : null}
          </Pressable>
        );
      })}
    </View>
  );

  if (layout === 'scroll' || layout === 'adaptive') {
    return (
      <ScrollView
        horizontal
        bounces={false}
        contentInsetAdjustmentBehavior="never"
        directionalLockEnabled
        nestedScrollEnabled
        onScrollBeginDrag={event => event.stopPropagation()}
        onTouchStart={event => event.stopPropagation()}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row"
        contentContainerStyle={
          layout === 'adaptive' ? styles.adaptiveScrollContent : undefined
        }
        style={layout === 'adaptive' ? styles.adaptiveScroller : undefined}
      >
        {content}
      </ScrollView>
    );
  }

  return content;
}

const styles = StyleSheet.create({
  adaptiveContent: {
    flexGrow: 1,
    minWidth: '100%',
  },
  adaptiveScrollContent: {
    minWidth: '100%',
  },
  adaptiveScroller: {
    width: '100%',
  },
  adaptiveTab: {
    flexBasis: 72,
    flexGrow: 1,
    flexShrink: 0,
  },
});
