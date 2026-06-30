import React, {useCallback, useEffect, useState, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
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
  layout?: 'scroll' | 'equal';
  className?: string;
  renderCount?: (count: number) => ReactNode;
};

export function SegmentedTabs<T extends string>({
  tabs,
  selectedId,
  onSelect,
  variant = 'underline',
  layout = 'equal',
  className,
  renderCount,
}: SegmentedTabsProps<T>) {
  const [tabLayouts, setTabLayouts] = useState<
    Partial<Record<T, {x: number; width: number}>>
  >({});
  const indicatorX = useSharedValue(0);
  const indicatorWidth = useSharedValue(0);
  const selectedLayout = tabLayouts[selectedId];
  const pillInset = variant === 'pill' ? 1 : 0;

  const handleTabLayout = useCallback(
    (id: T, event: LayoutChangeEvent) => {
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
    },
    [],
  );

  useEffect(() => {
    if (!selectedLayout) return;
    indicatorX.value = withTiming(selectedLayout.x, {duration: 220});
    indicatorWidth.value = withTiming(selectedLayout.width, {duration: 220});
  }, [indicatorWidth, indicatorX, selectedLayout]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{translateX: indicatorX.value}],
    width: Math.max(0, indicatorWidth.value - pillInset * 2),
  }));

  const content = (
    <View
      className={`relative flex-row ${
        variant === 'pill'
          ? 'overflow-hidden rounded-full border border-base-200 bg-base-300'
          : ''
      } ${className ?? ''}`}
    >
      <Animated.View
        className={
          variant === 'pill'
            ? 'absolute rounded-full border border-primary bg-base-200'
            : 'absolute bottom-0 left-0 h-0.5 rounded-full bg-primary'
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
            accessibilityLabel={`${selected ? 'Selected' : 'Select'} ${tab.label}`}
            accessibilityState={{selected}}
            className={`h-9 items-center justify-center ${
              layout === 'equal' ? 'flex-1' : 'min-w-20 px-3'
            } ${variant === 'pill' ? 'flex-row gap-2 px-3' : 'pb-2 pt-1'}`}
            onLayout={event => handleTabLayout(tab.id, event)}
            onPress={() => {
              if (!selected) onSelect(tab.id);
            }}
          >
            <Text
              className={`${
                variant === 'pill'
                  ? 'text-xs font-bold uppercase'
                  : 'text-base font-semibold'
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

  if (layout === 'scroll') {
    return (
      <ScrollView
        horizontal
        bounces={false}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="flex-row"
      >
        {content}
      </ScrollView>
    );
  }

  return content;
}
