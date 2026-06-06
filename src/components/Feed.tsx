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
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {useAppTheme} from '../theme';

type FeedChromeProps = {
  scrollToTop: () => void;
  visible: boolean;
  scrolled: boolean;
  start: number;
};

export type FeedRenderItemInfo<T> = ListRenderItemInfo<T> & {
  visible: boolean;
};

export type FeedProps<T> = {
  items: T[];
  resetScrollKey?: string | number;
  getItemId?: (item: T, index: number) => string | number;
  renderItem: (info: FeedRenderItemInfo<T>) => ReactElement | null;
  header?: (props: FeedChromeProps) => ReactNode;
  stickyHeader?: (props: FeedChromeProps) => ReactNode;
  stickyHeaderSafeAreaColor?: string;
  stickyFooter?: (props: FeedChromeProps) => ReactNode;
  fixedHeader?: (props: FeedChromeProps) => ReactNode;
  headerSafeArea?: boolean;
  empty?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  visible?: boolean;
  pullToRefresh?: boolean;
  bottom?: boolean;
  bottomAutoScroll?: boolean | 'initial';
  maintainVisibleContentPosition?: boolean;
  stickyFooterVisible?: boolean;
  nearBottomThreshold?: number;
  onRefresh?: () => void | Promise<void>;
  onNearBottom?: (event: {distance: number}) => void;
  onViewportChange?: (state: {start: number; end: number; down: boolean}) => void;
  contentContainerClassName?: string;
  estimatedItemSize?: number;
  removeClippedSubviews?: boolean;
};

const NEAR_BOTTOM_THRESHOLD = 10;
const TOP_SAFE_AREA_OFFSET = 8;

function isDarkHex(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return true;
  const red = Math.floor(value / 65536) % 256;
  const green = Math.floor(value / 256) % 256;
  const blue = value % 256;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140;
}

function getRefreshControlColor(theme: ReturnType<typeof useAppTheme>) {
  return isDarkHex(theme.colors.base100) ? '#ffffff' : theme.colors.primary;
}

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
  resetScrollKey,
  getItemId = defaultGetItemId,
  renderItem,
  header,
  stickyHeader,
  stickyHeaderSafeAreaColor,
  stickyFooter,
  fixedHeader,
  headerSafeArea = true,
  empty,
  loading = false,
  refreshing = false,
  visible = true,
  pullToRefresh = false,
  bottom = false,
  bottomAutoScroll = true,
  maintainVisibleContentPosition = bottom,
  stickyFooterVisible = false,
  nearBottomThreshold = NEAR_BOTTOM_THRESHOLD,
  onRefresh,
  onNearBottom,
  onViewportChange,
  contentContainerClassName = 'pb-28',
  removeClippedSubviews = true,
}: FeedProps<T>) {
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [down, setDown] = useState(true);
  const listRef = useRef<FlashListRef<T>>(null);
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const lastOffsetRef = useRef(0);
  const nearBottomTriggeredRef = useRef(false);
  const lastItemsLengthRef = useRef(items.length);
  const didInitialBottomScrollRef = useRef(false);
  const headerVisible = useSharedValue(0);
  const footerVisible = useSharedValue(1);
  const topInset = Math.max(0, insets.top - TOP_SAFE_AREA_OFFSET);
  const refreshInset = headerSafeArea ? topInset : 0;
  const refreshColor = getRefreshControlColor(theme);

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({offset: 0, animated: true});
  }, []);

  const chromeProps = useMemo(
    () => ({visible: true, scrolled: start >= 1, start, scrollToTop}),
    [scrollToTop, start],
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
    if (resetScrollKey === undefined || bottom) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({offset: 0, animated: false});
      lastOffsetRef.current = 0;
      setDown(true);
    });
  }, [bottom, resetScrollKey]);

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
    backgroundColor: stickyHeaderSafeAreaColor ?? theme.colors.base100,
    paddingTop: topInset,
    transform: [{translateY: (1 - headerVisible.value) * -(72 + topInset)}],
  }), [stickyHeaderSafeAreaColor, theme.colors.base100, topInset]);

  const stickyFooterStyle = useAnimatedStyle(() => ({
    opacity: footerVisible.value,
    paddingBottom: insets.bottom,
    transform: [{translateY: (1 - footerVisible.value) * (88 + insets.bottom)}],
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
    return (
      <View className="w-full">
        {headerSafeArea && topInset > 0 ? (
          <View
            pointerEvents="none"
            style={{height: topInset}}
          />
        ) : null}
        {header({...chromeProps, scrolled: false})}
      </View>
    );
  }, [chromeProps, header, headerSafeArea, topInset]);

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View className="px-6 py-14">
          <Text className="text-center text-base text-primary-content">Loading...</Text>
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
          className="absolute bottom-0 left-0 right-0 top-0 z-40"
          style={{paddingTop: topInset}}
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
          maintainVisibleContentPosition
            ? bottom && bottomAutoScroll === true
              ? {
                  startRenderingFromBottom: true,
                  autoscrollToBottomThreshold: 0.2,
                  animateAutoScrollToBottom: true,
                }
              : undefined
            : {disabled: true}
        }
        onEndReached={handleEndReached}
        onEndReachedThreshold={0.35}
        onScroll={handleScroll}
        onViewableItemsChanged={handleViewableItemsChanged}
        refreshControl={
          pullToRefresh && onRefresh ? (
            <RefreshControl
              colors={[refreshColor]}
              progressViewOffset={refreshInset}
              progressBackgroundColor={theme.colors.base200}
              refreshing={refreshing}
              tintColor={refreshColor}
              onRefresh={onRefresh}
            />
          ) : undefined
        }
        removeClippedSubviews={removeClippedSubviews}
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
