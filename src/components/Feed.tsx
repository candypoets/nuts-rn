import React, {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as ReactNative from 'react-native';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type {ColumnWrapperStyle} from '@legendapp/list/react-native';
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo as FlashListRenderItemInfo,
} from '@shopify/flash-list';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  type SharedValue,
  interpolate,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import HeaderMotion, {useMotionProgress} from 'react-native-header-motion';
import {getFeedTopInset} from './feedLayout';
import {useAppTheme} from '../theme';

type FeedChromeProps = {
  scrollY: SharedValue<number>;
  scrollToTop: () => void;
  safeAreaTop: number;
  visible: boolean;
  scrolled: boolean;
  start: number;
};

export type FeedRenderItemInfo<T> = {
  data: readonly T[];
  extraData?: unknown;
  index: number;
  item: T;
  type?: string | number;
  visible: boolean;
};

export type FeedProps<T> = {
  items: T[];
  resetScrollKey?: string | number;
  scrollToTopKey?: string | number;
  scrollToBottomKey?: string | number;
  getItemId?: (item: T, index: number) => string | number;
  renderItem: (info: FeedRenderItemInfo<T>) => ReactElement | null;
  header?: (props: FeedChromeProps) => ReactNode;
  motionHeader?: (props: FeedChromeProps) => ReactNode;
  footer?: (props: FeedChromeProps) => ReactNode;
  stickyHeader?: (props: FeedChromeProps) => ReactNode;
  stickyHeaderSafeAreaColor?: string;
  stickyFooter?: (props: FeedChromeProps) => ReactNode;
  headerSafeArea?: boolean;
  headerOwnsSafeArea?: boolean;
  empty?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  visible?: boolean;
  pullToRefresh?: boolean;
  bottom?: boolean;
  bottomAutoScroll?: boolean | 'initial';
  disableMaintainVisibleContentPosition?: boolean;
  stickyFooterVisible?: boolean;
  nearBottomThreshold?: number;
  numColumns?: number;
  columnWrapperStyle?: ColumnWrapperStyle;
  onRefresh?: () => void | Promise<void>;
  onNearBottom?: (event: {distance: number}) => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  onViewportStateChange?: (state: {start: number; down: boolean}) => void;
  contentContainerClassName?: string;
  removeClippedSubviews?: boolean;
};

const NEAR_BOTTOM_THRESHOLD = 10;
const REFRESH_INDICATOR_HEIGHT = 48;
const STICKY_HEADER_HIDE_OFFSET = 72;

type FeedVirtualItem<T> = {
  key: string;
  item: T;
  index: number;
};

type FeedVirtualRow<T> = {
  key: string;
  items: FeedVirtualItem<T>[];
};

type VirtualCollection<T> = {
  readonly size: number;
  at(index: number): T;
};

type VirtualColumnProps<TItem> = {
  children: (item: TItem, key: string) => ReactNode;
  items: VirtualCollection<TItem>;
  itemToKey?: (item: TItem) => string;
  removeClippedSubviews?: boolean;
  testID?: null | string;
};

const VirtualColumn = (
  ReactNative as typeof ReactNative & {
    unstable_VirtualColumn: <TItem>(
      props: VirtualColumnProps<TItem>,
    ) => ReactNode;
  }
).unstable_VirtualColumn;

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

/**
 * Keeps content in its expanded position while the rest of a motion header
 * collapses. Use this when the sticky controls appear before the dynamic
 * section in the expanded layout.
 */
export function FeedSticky({children}: {children: ReactNode}) {
  const {progress, progressThreshold} = useMotionProgress();
  const stickyStyle = useAnimatedStyle(() => {
    const threshold = progressThreshold.get();
    const distance = Number.isFinite(threshold) ? threshold : 0;
    return {
      zIndex: 10,
      transform: [{translateY: distance ? progress.get() * distance : 0}],
    };
  }, [progress, progressThreshold]);

  return (
    <Animated.View style={stickyStyle}>
      {children}
    </Animated.View>
  );
}

/**
 * Marks the measured section that scrolls away as a motion header collapses.
 */
export function FeedHeaderDynamic({children}: {children: ReactNode}) {
  const {progress} = useMotionProgress();
  const dynamicStyle = useAnimatedStyle(
    () => ({
      opacity: interpolate(
        progress.get(),
        [0, 0.82],
        [1, 0],
        Extrapolation.CLAMP,
      ),
    }),
    [progress],
  );

  return (
    <View className="overflow-hidden">
      <HeaderMotion.Header.Dynamic style={dynamicStyle}>
        {children}
      </HeaderMotion.Header.Dynamic>
    </View>
  );
}

function MotionHeader({
  children,
  paddingTop,
  surfaceColor,
}: {
  children: ReactNode;
  paddingTop: number;
  surfaceColor: string;
}) {
  const {progress, progressThreshold} = useMotionProgress();
  const headerStyle = useAnimatedStyle(() => {
    const threshold = progressThreshold.get();
    const distance = Number.isFinite(threshold) ? threshold : 0;
    return {
      transform: [{translateY: distance ? -progress.get() * distance : 0}],
      zIndex: 30,
    };
  }, [progress, progressThreshold]);

  return (
    <HeaderMotion.Header
      style={[
        {
          backgroundColor: surfaceColor,
          paddingTop,
        },
        headerStyle,
      ]}>
      {children}
    </HeaderMotion.Header>
  );
}

export function Feed<T>({
  items,
  resetScrollKey,
  scrollToTopKey,
  scrollToBottomKey,
  getItemId = defaultGetItemId,
  renderItem,
  header,
  motionHeader,
  footer,
  stickyHeader,
  stickyHeaderSafeAreaColor,
  stickyFooter,
  headerSafeArea = true,
  headerOwnsSafeArea = false,
  empty,
  loading = false,
  refreshing = false,
  visible = true,
  pullToRefresh = false,
  bottom = false,
  bottomAutoScroll = true,
  disableMaintainVisibleContentPosition = false,
  stickyFooterVisible = false,
  nearBottomThreshold = NEAR_BOTTOM_THRESHOLD,
  numColumns = 1,
  columnWrapperStyle,
  onRefresh,
  onNearBottom,
  onChromeVisibilityChange,
  onViewportStateChange,
  contentContainerClassName = 'pb-28',
  removeClippedSubviews = false,
}: FeedProps<T>) {
  const [start, setStart] = useState(0);
  const [down, setDown] = useState(true);
  const [nearTop, setNearTop] = useState(true);
  const listRef = useAnimatedRef<ScrollView>();
  const bottomListRef = useRef<FlashListRef<T>>(null);
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const lastOffsetRef = useRef(0);
  const lastStickyOffsetRef = useRef(0);
  const scrollViewportHeightRef = useRef(0);
  const scrollContentHeightRef = useRef(0);
  const nearBottomTriggeredRef = useRef(false);
  const lastItemsLengthRef = useRef(items.length);
  const didInitialBottomScrollRef = useRef(false);
  const stickyReveal = useSharedValue(0);
  const stickyHeight = useSharedValue(88);
  const footerVisible = useSharedValue(1);
  const scrollY = useSharedValue(0);
  const topInset = getFeedTopInset(insets.top);
  const refreshInset = headerSafeArea ? topInset : 0;
  const headerSafeAreaTop = headerSafeArea ? topInset : 0;
  const outerHeaderSafeAreaTop = headerOwnsSafeArea ? 0 : headerSafeAreaTop;
  const innerHeaderSafeAreaTop = headerOwnsSafeArea ? headerSafeAreaTop : 0;
  const refreshColor = getRefreshControlColor(theme);
  const listItems = useMemo(
    () => items,
    [items],
  );
  const virtualRows = useMemo<FeedVirtualRow<T>[]>(() => {
    const columns = Math.max(1, numColumns);
    const rows: FeedVirtualRow<T>[] = [];
    for (let index = 0; index < listItems.length; index += columns) {
      const rowItems = listItems
        .slice(index, index + columns)
        .map((item, columnIndex) => {
          const itemIndex = index + columnIndex;
          return {
            key: String(getItemId(item, itemIndex)),
            item,
            index: itemIndex,
          };
        });
      rows.push({
        key: rowItems.map(item => item.key).join(':'),
        items: rowItems,
      });
    }
    return rows;
  }, [getItemId, listItems, numColumns]);
  const virtualRowsCollection = useMemo<VirtualCollection<FeedVirtualRow<T>>>(
    () => ({
      size: virtualRows.length,
      at(index: number) {
        const row = virtualRows[index];
        if (!row) {
          throw new RangeError(`Cannot get feed row ${index}`);
        }
        return row;
      },
    }),
    [virtualRows],
  );
  const shouldMaintainVisibleContentPosition =
    !disableMaintainVisibleContentPosition && (items.length > 0 || !loading);

  const scrollToTop = useCallback(() => {
    if (bottom) {
      bottomListRef.current?.scrollToOffset({offset: 0, animated: true});
    } else {
      listRef.current?.scrollTo({y: 0, animated: true});
    }
  }, [bottom, listRef]);

  const scrollToBottom = useCallback((animated: boolean) => {
    if (bottom) {
      bottomListRef.current?.scrollToOffset({offset: 0, animated});
    } else {
      listRef.current?.scrollToEnd({animated});
    }
  }, [bottom, listRef]);

  const chromeProps = useMemo(
    () => ({
      visible: true,
      scrolled: start >= 1,
      scrollY,
      safeAreaTop: innerHeaderSafeAreaTop,
      start,
      scrollToTop,
    }),
    [innerHeaderSafeAreaTop, scrollToTop, scrollY, start],
  );

  useEffect(() => {
    if (start === 0 || items.length < lastItemsLengthRef.current) {
      nearBottomTriggeredRef.current = false;
    }
    lastItemsLengthRef.current = items.length;
  }, [items.length, start]);

  useEffect(() => {
    if (!bottom) return;
    const shouldInitialScroll =
      (bottomAutoScroll === 'initial' || bottomAutoScroll === true) &&
      !didInitialBottomScrollRef.current;
    const shouldContinuousScroll = bottomAutoScroll === true && start <= 1;
    if (
      items.length === 0 ||
      (!shouldInitialScroll && !shouldContinuousScroll)
    ) {
      return;
    }
    requestAnimationFrame(() => {
      scrollToBottom(false);
      didInitialBottomScrollRef.current = true;
    });
  }, [bottom, bottomAutoScroll, items.length, scrollToBottom, start]);

  useEffect(() => {
    if (resetScrollKey === undefined || bottom) return;
    stickyReveal.value = 0;
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({y: 0, animated: false});
      lastOffsetRef.current = 0;
      setDown(true);
    });
  }, [bottom, listRef, resetScrollKey, stickyReveal]);

  useEffect(() => {
    if (scrollToTopKey === undefined) return;
    stickyReveal.value = 0;
    requestAnimationFrame(() => {
      scrollToTop();
      lastOffsetRef.current = 0;
      setDown(true);
    });
  }, [scrollToTop, scrollToTopKey, stickyReveal]);

  useEffect(() => {
    if (scrollToBottomKey === undefined) return;
    requestAnimationFrame(() => {
      scrollToBottom(true);
      lastOffsetRef.current = 0;
      setDown(true);
    });
  }, [scrollToBottom, scrollToBottomKey]);

  useEffect(() => {
    onChromeVisibilityChange?.(!down || start < 1);
  }, [down, onChromeVisibilityChange, start]);

  useEffect(() => {
    onViewportStateChange?.({start, down});
  }, [down, onViewportStateChange, start]);

  useEffect(() => {
    if (nearTop || start < 1) {
      stickyReveal.value = withTiming(0, {duration: 220});
    }
    footerVisible.value = withTiming(
      bottom || stickyFooterVisible || !down || start < 1 ? 1 : 0,
      {duration: 220},
    );
  }, [bottom, down, footerVisible, nearTop, start, stickyFooterVisible, stickyReveal]);

  const stickyHeaderStyle = useAnimatedStyle(() => ({
    opacity: stickyReveal.value,
    backgroundColor: stickyHeaderSafeAreaColor ?? theme.colors.base100,
    paddingTop: outerHeaderSafeAreaTop,
    transform: [{translateY: (stickyReveal.value - 1) * stickyHeight.value}],
  }), [outerHeaderSafeAreaTop, stickyHeaderSafeAreaColor, theme.colors.base100]);

  const handleStickyLayout = useCallback((event: LayoutChangeEvent) => {
    stickyHeight.value = event.nativeEvent.layout.height;
  }, [stickyHeight]);

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
      const distance = Math.max(0, items.length - nextEnd);
      if (nextStart === 0 || distance > nearBottomThreshold) {
        nearBottomTriggeredRef.current = false;
      }

    },
    [items.length, nearBottomThreshold],
  );

  const maybeTriggerNearBottom = useCallback((distance: number, offset: number) => {
    if (
      !onNearBottom ||
      items.length === 0 ||
      offset <= 0 ||
      distance > nearBottomThreshold ||
      nearBottomTriggeredRef.current
    ) {
      return;
    }
    nearBottomTriggeredRef.current = true;
    onNearBottom({distance: Math.max(0, distance)});
  }, [items.length, nearBottomThreshold, onNearBottom]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
    const offset = contentOffset.y;
    scrollY.value = offset;
    scrollViewportHeightRef.current = layoutMeasurement.height;
    scrollContentHeightRef.current = contentSize.height;
    setStart(offset >= 1 ? 1 : 0);
    setNearTop(offset < STICKY_HEADER_HIDE_OFFSET);
    const stickyDelta = offset - lastStickyOffsetRef.current;
    lastStickyOffsetRef.current = offset;
    if (offset <= STICKY_HEADER_HIDE_OFFSET + stickyHeight.value) {
      stickyReveal.value = 0;
    } else {
      stickyReveal.value = Math.min(
        1,
        Math.max(0, stickyReveal.value - stickyDelta / stickyHeight.value),
      );
    }
    const distanceFromBottom = Math.max(
      0,
      contentSize.height - layoutMeasurement.height - offset,
    );
    if (offset <= 0 || distanceFromBottom > nearBottomThreshold) {
      nearBottomTriggeredRef.current = false;
    }
    maybeTriggerNearBottom(distanceFromBottom, offset);
    const delta = offset - lastOffsetRef.current;
    if (Math.abs(delta) > 4) {
      setDown(delta > 0);
      lastOffsetRef.current = offset;
    }
  }, [maybeTriggerNearBottom, nearBottomThreshold, scrollY, stickyHeight, stickyReveal]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    scrollContentHeightRef.current = height;
    const distanceFromBottom = Math.max(
      0,
      height - scrollViewportHeightRef.current - lastOffsetRef.current,
    );
    if (lastOffsetRef.current <= 0 || distanceFromBottom > nearBottomThreshold) {
      nearBottomTriggeredRef.current = false;
    }
    maybeTriggerNearBottom(distanceFromBottom, lastOffsetRef.current);
  }, [maybeTriggerNearBottom, nearBottomThreshold]);

  const keyExtractor = useCallback(
    (item: T, index: number) => String(getItemId(item, index)),
    [getItemId],
  );
  const renderBottomItem = useCallback(
    (info: FlashListRenderItemInfo<T>) => (
      renderItem({
        item: info.item,
        index: info.index,
        extraData: info.extraData,
        data: items,
        visible,
      })
    ),
    [items, renderItem, visible],
  );
  const handleEndReached = useCallback((event?: {distanceFromEnd?: number}) => {
    if (
      !onNearBottom ||
      items.length === 0 ||
      start === 0 ||
      nearBottomTriggeredRef.current
    ) {
      return;
    }
    nearBottomTriggeredRef.current = true;
    onNearBottom({distance: Math.max(0, event?.distanceFromEnd ?? 0)});
  }, [items.length, onNearBottom, start]);

  const renderVirtualRowContent = useCallback(
    (row: FeedVirtualRow<T>) => {
      const rowContent = row.items.map(({key, item, index}) => (
        <View
          key={key}
          className={numColumns > 1 ? 'flex-1' : undefined}
        >
          {renderItem({
            item,
            index,
            data: items,
            visible,
          })}
        </View>
      ));
      if (numColumns <= 1) {
        return rowContent[0] ?? null;
      }
      return (
        <View style={columnWrapperStyle}>
          {rowContent}
        </View>
      );
    },
    [columnWrapperStyle, items, numColumns, renderItem, visible],
  );

  const showCustomRefreshIndicator =
    !bottom && pullToRefresh && !!onRefresh && refreshing;
  const customRefreshInset = motionHeader ? 0 : refreshInset;
  const listHeader = useMemo(() => {
    if (!header && !showCustomRefreshIndicator) return null;
    const inFlowChromeProps = showCustomRefreshIndicator
      ? {...chromeProps, safeAreaTop: 0}
      : chromeProps;
    const inFlowHeaderPaddingTop = showCustomRefreshIndicator
      ? 0
      : outerHeaderSafeAreaTop;
    return (
      <>
        {showCustomRefreshIndicator ? (
          <View
            accessibilityLabel="Refreshing"
            accessibilityRole="progressbar"
            className="w-full items-center justify-center bg-base-100"
            style={{
              height: customRefreshInset + REFRESH_INDICATOR_HEIGHT,
              paddingTop: customRefreshInset,
            }}
            testID="feed-refresh-indicator"
          >
            <ActivityIndicator color={refreshColor} />
          </View>
        ) : null}
        {header ? (
          <View
            className="w-full"
            style={{
              backgroundColor: theme.colors.base100,
              paddingTop: inFlowHeaderPaddingTop,
            }}
          >
            {header({...inFlowChromeProps, scrolled: false})}
          </View>
        ) : null}
      </>
    );
  }, [
    chromeProps,
    customRefreshInset,
    header,
    outerHeaderSafeAreaTop,
    refreshColor,
    showCustomRefreshIndicator,
    theme.colors.base100,
  ]);

  const listFooter = useMemo(() => {
    if (!footer) return null;
    return <View className="w-full">{footer(chromeProps)}</View>;
  }, [chromeProps, footer]);

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
  const stickyContent = stickyHeader ? stickyHeader(chromeProps) : null;
  const feedContent = (
    <View
      className="relative flex-1"
      style={{backgroundColor: theme.colors.base100}}>
      {motionHeader ? (
        <MotionHeader
          paddingTop={outerHeaderSafeAreaTop}
          surfaceColor={theme.colors.base100}>
          {motionHeader(chromeProps)}
        </MotionHeader>
      ) : null}
      {bottom ? (
        <FlashList
          ref={bottomListRef}
          contentInsetAdjustmentBehavior="never"
          data={items}
          keyExtractor={keyExtractor}
          renderItem={renderBottomItem}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          ListEmptyComponent={listEmpty}
          className="flex-1"
          contentContainerClassName={contentContainerClassName}
          inverted
          initialScrollIndex={items.length ? 0 : undefined}
          maintainVisibleContentPosition={
            shouldMaintainVisibleContentPosition
              ? bottomAutoScroll === true
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
              // The native spinner can remain visible after `refreshing` turns false.
              // Keep it as an invisible gesture detector and render the bounded
              // in-flow indicator above for non-inverted feeds.
              <RefreshControl
                colors={[bottom ? refreshColor : 'transparent']}
                progressViewOffset={refreshInset}
                progressBackgroundColor={
                  bottom ? theme.colors.base200 : 'transparent'
                }
                refreshing={bottom ? refreshing : false}
                tintColor={bottom ? refreshColor : 'transparent'}
                onRefresh={onRefresh}
              />
            ) : undefined
          }
          scrollEventThrottle={16}
        />
      ) : motionHeader ? (
        <HeaderMotion.ScrollView
          animatedRef={listRef as never}
          className="flex-1"
          contentInsetAdjustmentBehavior="never"
          contentContainerClassName={contentContainerClassName}
          maintainVisibleContentPosition={
            shouldMaintainVisibleContentPosition && !showCustomRefreshIndicator
              ? {minIndexForVisible: 0}
              : undefined
          }
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleScroll}
          refreshControl={
            pullToRefresh && onRefresh ? (
              <RefreshControl
                colors={['transparent']}
                progressBackgroundColor="transparent"
                refreshing={false}
                tintColor="transparent"
                onRefresh={onRefresh}
              />
            ) : undefined
          }
          scrollEventThrottle={16}
        >
          {listHeader}
          {items.length === 0 ? (
            listEmpty
          ) : (
            <VirtualColumn
              items={virtualRowsCollection}
              itemToKey={row => row.key}
              removeClippedSubviews={removeClippedSubviews}
              testID={`feed-virtual-column:${numColumns}`}
            >
              {renderVirtualRowContent}
            </VirtualColumn>
          )}
          {listFooter}
        </HeaderMotion.ScrollView>
      ) : (
        <ScrollView
          ref={listRef}
          className="flex-1"
          contentInsetAdjustmentBehavior="never"
          contentContainerClassName={contentContainerClassName}
          maintainVisibleContentPosition={
            shouldMaintainVisibleContentPosition && !showCustomRefreshIndicator
              ? {minIndexForVisible: 0}
              : undefined
          }
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleScroll}
          refreshControl={
            pullToRefresh && onRefresh ? (
              // See the FlashList refresh control above.
              <RefreshControl
                colors={['transparent']}
                progressViewOffset={refreshInset}
                progressBackgroundColor="transparent"
                refreshing={false}
                tintColor="transparent"
                onRefresh={onRefresh}
              />
            ) : undefined
          }
          scrollEventThrottle={16}
        >
          {listHeader}
          {items.length === 0 ? (
            listEmpty
          ) : (
            <VirtualColumn
              items={virtualRowsCollection}
              itemToKey={row => row.key}
              removeClippedSubviews={removeClippedSubviews}
              testID={`feed-virtual-column:${numColumns}`}
            >
              {renderVirtualRowContent}
            </VirtualColumn>
          )}
          {listFooter}
        </ScrollView>
      )}
      {stickyContent ? (
        <Animated.View
          pointerEvents={start >= 1 && !down && !nearTop ? 'auto' : 'none'}
          className="absolute left-0 right-0 top-0 z-30"
          onLayout={handleStickyLayout}
          style={stickyHeaderStyle}>
          <Pressable onPress={scrollToTop}>{stickyContent}</Pressable>
        </Animated.View>
      ) : null}
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

  return motionHeader ? (
    <HeaderMotion measureDynamicMode="update">
      {feedContent}
    </HeaderMotion>
  ) : (
    feedContent
  );
}
