import React, {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo,
} from '@shopify/flash-list';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

type FeedChromeProps = {
  visible: boolean;
  scrolled: boolean;
  start: number;
};

export type FeedRenderItemInfo<T> = ListRenderItemInfo<T> & {
  visible: boolean;
};

export type FeedProps<T> = {
  items: T[];
  getItemId?: (item: T, index: number) => string | number;
  renderItem: (info: FeedRenderItemInfo<T>) => ReactElement | null;
  header?: (props: FeedChromeProps) => ReactNode;
  stickyHeader?: (props: FeedChromeProps) => ReactNode;
  stickyFooter?: (props: FeedChromeProps) => ReactNode;
  fixedHeader?: (props: FeedChromeProps) => ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  visible?: boolean;
  pullToRefresh?: boolean;
  bottom?: boolean;
  bottomAutoScroll?: boolean | 'initial';
  stickyFooterVisible?: boolean;
  nearBottomThreshold?: number;
  onRefresh?: () => void | Promise<void>;
  onNearBottom?: (event: {distance: number}) => void;
  onViewportChange?: (state: {start: number; end: number; down: boolean}) => void;
  contentContainerClassName?: string;
  estimatedItemSize?: number;
};

const NEAR_BOTTOM_THRESHOLD = 10;

function defaultGetItemId<T>(item: T, index: number) {
  const maybeItem = item as T & {id?: unknown};
  if (typeof maybeItem?.id === 'function') {
    const id = (maybeItem.id as () => string | number | undefined)();
    if (id !== undefined) return id;
  }
  if (typeof maybeItem?.id === 'string' || typeof maybeItem?.id === 'number') {
    return maybeItem.id;
  }
  return index;
}

export function Feed<T>({
  items,
  getItemId = defaultGetItemId,
  renderItem,
  header,
  stickyHeader,
  stickyFooter,
  fixedHeader,
  empty,
  loading = false,
  refreshing = false,
  visible = true,
  pullToRefresh = false,
  bottom = false,
  bottomAutoScroll = true,
  stickyFooterVisible = false,
  nearBottomThreshold = NEAR_BOTTOM_THRESHOLD,
  onRefresh,
  onNearBottom,
  onViewportChange,
  contentContainerClassName = 'pb-28',
}: FeedProps<T>) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [down, setDown] = useState(true);
  const listRef = useRef<FlashListRef<T>>(null);
  const lastOffsetRef = useRef(0);
  const nearBottomTriggeredRef = useRef(false);
  const lastItemsLengthRef = useRef(items.length);
  const didInitialBottomScrollRef = useRef(false);
  const headerVisible = useSharedValue(0);
  const footerVisible = useSharedValue(1);

  const chromeProps = useMemo(
    () => ({visible: true, scrolled: start >= 1, start}),
    [start],
  );

  useEffect(() => {
    if (start === 0 || items.length < lastItemsLengthRef.current) {
      nearBottomTriggeredRef.current = false;
    }
    lastItemsLengthRef.current = items.length;
  }, [items.length, start]);

  useEffect(() => {
    const shouldInitialScroll =
      bottomAutoScroll === 'initial' && !didInitialBottomScrollRef.current;
    const shouldContinuousScroll = bottomAutoScroll === true;
    if (
      !bottom ||
      items.length === 0 ||
      start > 1 ||
      (!shouldInitialScroll && !shouldContinuousScroll)
    ) {
      return;
    }
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({offset: 0, animated: false});
      didInitialBottomScrollRef.current = true;
    });
  }, [bottom, bottomAutoScroll, items.length, start]);

  useEffect(() => {
    onViewportChange?.({start, end, down});
  }, [down, end, onViewportChange, start]);

  useEffect(() => {
    headerVisible.value = withTiming(start >= 1 && !down ? 1 : 0, {
      duration: 220,
    });
    footerVisible.value = withTiming(
      bottom || stickyFooterVisible || !down || start < 1 ? 1 : 0,
      {duration: 220},
    );
  }, [bottom, down, footerVisible, headerVisible, start, stickyFooterVisible]);

  const stickyHeaderStyle = useAnimatedStyle(() => ({
    opacity: headerVisible.value,
    transform: [{translateY: (1 - headerVisible.value) * -72}],
  }));

  const stickyFooterStyle = useAnimatedStyle(() => ({
    opacity: footerVisible.value,
    transform: [{translateY: (1 - footerVisible.value) * 88}],
  }));

  const handleViewableItemsChanged = useCallback(
    ({viewableItems}: {viewableItems: Array<{index: number | null}>}) => {
      const indexes = viewableItems
        .map(item => item.index)
        .filter((index): index is number => typeof index === 'number')
        .sort((a, b) => a - b);
      if (!indexes.length) return;
      const nextStart = indexes[0] ?? 0;
      const nextEnd = (indexes[indexes.length - 1] ?? nextStart) + 1;
      setStart(nextStart);
      setEnd(nextEnd);
      const distance = Math.max(0, items.length - nextEnd);
      if (nextStart === 0 || distance > nearBottomThreshold) {
        nearBottomTriggeredRef.current = false;
      }

    },
    [items.length, nearBottomThreshold],
  );

  const handleScroll = useCallback((event: {nativeEvent: {contentOffset: {y: number}}}) => {
    const offset = event.nativeEvent.contentOffset.y;
    const delta = offset - lastOffsetRef.current;
    if (Math.abs(delta) > 4) {
      setDown(delta > 0);
      lastOffsetRef.current = offset;
    }
  }, []);

  const keyExtractor = useCallback(
    (item: T, index: number) => String(getItemId(item, index)),
    [getItemId],
  );
  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({offset: 0, animated: true});
  }, []);
  const handleEndReached = useCallback(() => {
    if (
      !onNearBottom ||
      items.length === 0 ||
      start === 0 ||
      nearBottomTriggeredRef.current
    ) {
      return;
    }
    const distance = Math.max(0, items.length - end);
    if (distance <= nearBottomThreshold) {
      nearBottomTriggeredRef.current = true;
      onNearBottom({distance});
    }
  }, [end, items.length, nearBottomThreshold, onNearBottom, start]);

  const listHeader = useMemo(() => {
    if (!header) return null;
    return <View className="w-full">{header({...chromeProps, scrolled: false})}</View>;
  }, [chromeProps, header]);

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View className="px-6 py-14">
          <Text className="text-center text-base text-slate-500">Loading...</Text>
        </View>
      );
    }
    return empty ? <View className="px-6 py-12">{empty}</View> : null;
  }, [empty, loading]);

  return (
    <View className="relative flex-1">
      {fixedHeader ? (
        <View
          pointerEvents="box-none"
          className="absolute bottom-0 left-0 right-0 top-0 z-20"
        >
          {fixedHeader(chromeProps)}
        </View>
      ) : null}
      {stickyHeader ? (
        <Animated.View
          pointerEvents={start >= 1 && !down ? 'auto' : 'none'}
          className="absolute left-0 right-0 top-0 z-30"
          style={stickyHeaderStyle}>
          <Pressable onPress={scrollToTop}>{stickyHeader(chromeProps)}</Pressable>
        </Animated.View>
      ) : null}
      <FlashList
        ref={listRef}
        data={items}
        keyExtractor={keyExtractor}
        renderItem={info =>
          renderItem({
            ...info,
            visible: visible && info.index >= start - 5,
          })
        }
        ListHeaderComponent={listHeader}
        ListEmptyComponent={listEmpty}
        className="flex-1"
        contentContainerClassName={contentContainerClassName}
        inverted={bottom}
        initialScrollIndex={bottom && items.length ? 0 : undefined}
        maintainVisibleContentPosition={
          bottom && bottomAutoScroll === true
            ? {
                startRenderingFromBottom: true,
                autoscrollToBottomThreshold: 0.2,
                animateAutoScrollToBottom: true,
              }
            : undefined
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.35}
        onScroll={handleScroll}
        onViewableItemsChanged={handleViewableItemsChanged}
        refreshControl={
          pullToRefresh && onRefresh ? (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          ) : undefined
        }
        removeClippedSubviews
        scrollEventThrottle={16}
        viewabilityConfig={{
          itemVisiblePercentThreshold: 1,
          minimumViewTime: 40,
        }}
      />
      {stickyFooter ? (
        <Animated.View
          pointerEvents="box-none"
          className="absolute bottom-0 left-0 right-0 z-30"
          style={stickyFooterStyle}>
          {stickyFooter(chromeProps)}
        </Animated.View>
      ) : null}
    </View>
  );
}
