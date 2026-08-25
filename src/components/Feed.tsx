import React, {
  type ReactElement,
  type Ref,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as ReactNative from 'react-native';
import { BlurView } from 'expo-blur';
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewStyle,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  FlashList,
  type FlashListRef,
  type ListRenderItemInfo as FlashListRenderItemInfo,
} from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  ReduceMotion,
  type SharedValue,
  interpolate,
  useAnimatedRef,
  useAnimatedReaction,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import HeaderMotion, { useMotionProgress } from 'react-native-header-motion';
import { getFeedTopInset } from './feedLayout';
import { useAppTheme } from '../theme';
import { MediaActivityProvider } from '../media/MediaActivity';

export type FeedChromeProps = {
  scrollY: SharedValue<number>;
  scrollToTop: () => void;
  safeAreaTop: number;
  visible: boolean;
  scrolled: boolean;
  start: number;
};

export type FeedMotionChromeProps = Pick<
  FeedChromeProps,
  'safeAreaTop' | 'scrollToTop' | 'scrollY' | 'visible'
>;

export type FeedRenderItemInfo<T> = {
  data: readonly T[];
  extraData?: unknown;
  index: number;
  item: T;
  type?: string | number;
  /** Controls this item's data and subscription lifecycle. */
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
  motionHeaderPressToTop?: boolean;
  motionHeaderOverlaysContent?: boolean;
  motionHeaderSurfaceColor?: string;
  /** Joins a HeaderMotion provider owned by an ancestor. */
  motionScrollId?: string;
  /** Exposes the stable controls needed by an ancestor-owned motion header. */
  motionChromeRef?: Ref<FeedMotionChromeProps>;
  footer?: (props: FeedChromeProps) => ReactNode;
  stickyHeader?: (props: FeedChromeProps) => ReactNode;
  stickyHeaderSafeAreaColor?: string;
  stickyFooter?: (props: FeedChromeProps) => ReactNode;
  headerSafeArea?: boolean;
  headerOwnsSafeArea?: boolean;
  empty?: ReactNode;
  loading?: boolean;
  refreshing?: boolean;
  /** Controls the feed's data/subscription lifecycle. */
  visible?: boolean;
  /** Pauses viewport media without unmounting the retained feed surface. */
  screenActive?: boolean;
  pullToRefresh?: boolean;
  bottom?: boolean;
  bottomAutoScroll?: boolean | 'initial';
  disableMaintainVisibleContentPosition?: boolean;
  /**
   * Motion-header path only: renders rows as direct children of the native
   * scroll view instead of inside HeaderMotion's content wrapper view. The
   * platform maintainVisibleContentPosition anchors on the first visible
   * DIRECT child of the scroll content view; inside the wrapper it can never
   * see the rows, so prepended content (e.g. thread ancestors) pushes the
   * viewport. Only use with a motion header whose total height is fixed after
   * mount — a header-height change would be compensated like prepended
   * content.
   */
  unwrappedMotionContent?: boolean;
  /**
   * Motion-header path only: forwarded as maintainVisibleContentPosition's
   * minIndexForVisible. Thread screens pass the ancestor-row count so the
   * anchor stays pinned to the focused row. With the default 0 the anchor
   * sticks to the topmost partially visible row — an ancestor skeleton —
   * and that row's height growth when its note resolves is never
   * compensated (the helper only tracks the anchor's top edge).
   */
  maintainVisibleContentMinIndex?: number;
  stickyFooterVisible?: boolean;
  nearBottomThreshold?: number;
  numColumns?: number;
  columnWrapperStyle?: ViewStyle;
  onRefresh?: () => void | Promise<void>;
  onNearBottom?: (event: { distance: number }) => void;
  onChromeVisibilityChange?: (visible: boolean) => void;
  onViewportStateChange?: (state: { start: number; down: boolean }) => void;
  contentContainerClassName?: string;
  removeClippedSubviews?: boolean;
};

const NEAR_BOTTOM_THRESHOLD = 10;
const REFRESH_INDICATOR_HEIGHT = 48;
const STICKY_HEADER_HIDE_OFFSET = 72;
const MOTION_HEADER_DIRECTION_TOLERANCE = 0.5;
const VIRTUAL_VIEW_VISIBLE_MODE = 0;

const styles = StyleSheet.create({
  motionHeaderSurface: {
    backgroundColor: 'transparent',
  },
});

type FeedVirtualItem<T> = {
  key: string;
  item: T;
  index: number;
};

type FeedVirtualRow<T> = {
  key: string;
  items: FeedVirtualItem<T>[];
  viewport: FeedViewportStore;
};

type FeedViewportStore = {
  getSnapshot: () => boolean;
  setMode: (mode: number) => void;
  subscribe: (listener: () => void) => () => void;
};

type FeedModeChangeEvent = Readonly<{
  mode: number;
}>;

type VirtualCollection<T> = {
  readonly size: number;
  at(index: number): T;
};

type VirtualColumnProps<TItem> = {
  children: (item: TItem, key: string) => ReactNode;
  items: VirtualCollection<TItem>;
  itemToKey?: (item: TItem) => string;
  onItemModeChange?: (
    item: TItem,
    key: string,
    event: FeedModeChangeEvent,
  ) => void;
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

function createFeedViewportStore(): FeedViewportStore {
  // VirtualView's native initial mode is Visible. It does not emit a no-op
  // Visible -> Visible transition for rows already onscreen at first layout.
  let visible = true;
  const listeners = new Set<() => void>();

  return {
    getSnapshot: () => visible,
    setMode: mode => {
      const nextVisible = mode === VIRTUAL_VIEW_VISIBLE_MODE;
      if (visible === nextVisible) return;
      visible = nextVisible;
      listeners.forEach(listener => listener());
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

type FeedVirtualRowContentProps<T> = {
  columnWrapperStyle?: ViewStyle;
  data: readonly T[];
  numColumns: number;
  renderItem: (info: FeedRenderItemInfo<T>) => ReactElement | null;
  row: FeedVirtualRow<T>;
  visible: boolean;
  screenActive: boolean;
};

function FeedVirtualRowContent<T>({
  columnWrapperStyle,
  data,
  numColumns,
  renderItem,
  row,
  visible,
  screenActive,
}: FeedVirtualRowContentProps<T>) {
  const viewportVisible = useSyncExternalStore(
    row.viewport.subscribe,
    row.viewport.getSnapshot,
    row.viewport.getSnapshot,
  );
  const mediaActive = screenActive && viewportVisible;
  const rowContent = row.items.map(({ key, item, index }) => (
    <MediaActivityProvider key={key} active={mediaActive}>
      <View className={numColumns > 1 ? 'flex-1' : undefined}>
        {renderItem({
          item,
          index,
          data,
          visible,
        })}
      </View>
    </MediaActivityProvider>
  ));

  if (numColumns <= 1) {
    return rowContent[0] ?? null;
  }
  return <View style={columnWrapperStyle}>{rowContent}</View>;
}

function isDarkHex(hex: string) {
  const normalized = hex.replace('#', '').slice(0, 6);
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value)) return true;
  const red = Math.floor(value / 65536) % 256;
  const green = Math.floor(value / 256) % 256;
  const blue = value % 256;
  return (red * 299 + green * 587 + blue * 114) / 1000 < 140;
}

function withAlpha(hex: string, opacity: number) {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${alpha}`;
}

function getRefreshControlColor(theme: ReturnType<typeof useAppTheme>) {
  return isDarkHex(theme.colors.base100) ? '#ffffff' : theme.colors.primary;
}

export function FeedHeaderBlurSurface({
  surfaceColor,
}: {
  surfaceColor: string;
}) {
  if (surfaceColor === 'transparent') return null;

  return (
    <BlurView
      blurMethod={
        Platform.OS === 'android' ? 'dimezisBlurViewSdk31Plus' : undefined
      }
      intensity={Platform.OS === 'ios' ? 24 : 18}
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: withAlpha(surfaceColor, 0.76) },
      ]}
      tint={isDarkHex(surfaceColor) ? 'dark' : 'light'}
    />
  );
}

function defaultGetItemId<T>(item: T, index: number) {
  const maybeItem = item as T & { id?: unknown };
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
export function FeedSticky({ children }: { children: ReactNode }) {
  const { progress, progressThreshold } = useMotionProgress();
  const stickyStyle = useAnimatedStyle(() => {
    const threshold = progressThreshold.get();
    const distance = Number.isFinite(threshold) ? threshold : 0;
    return {
      zIndex: 10,
      transform: [{ translateY: distance ? progress.get() * distance : 0 }],
    };
  }, [progress, progressThreshold]);

  return <Animated.View style={stickyStyle}>{children}</Animated.View>;
}

/**
 * Marks the measured section that scrolls away as a motion header collapses.
 */
export function FeedHeaderDynamic({ children }: { children: ReactNode }) {
  const { progress } = useMotionProgress();
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
  onPress,
  paddingTop,
  scrollY,
  surfaceColor,
}: {
  children: ReactNode;
  onPress?: () => void;
  paddingTop: number;
  scrollY: SharedValue<number>;
  surfaceColor: string;
}) {
  const { progress, progressThreshold } = useMotionProgress();
  const headerHeight = useSharedValue(0);
  const revealProgress = useSharedValue(1);

  const handleLayout = useCallback(
    (event: LayoutChangeEvent) => {
      headerHeight.set(event.nativeEvent.layout.height);
    },
    [headerHeight],
  );

  useAnimatedReaction(
    () => ({
      offset: scrollY.get(),
      progress: progress.get(),
      threshold: progressThreshold.get(),
    }),
    (current, previous) => {
      const hasDynamicSection = Number.isFinite(current.threshold);
      const isCollapsed = hasDynamicSection
        ? current.progress >= 0.999
        : current.offset > STICKY_HEADER_HIDE_OFFSET;

      if (!isCollapsed || current.offset <= 0) {
        revealProgress.set(1);
        return;
      }

      if (!previous) return;
      const delta = current.offset - previous.offset;
      if (Math.abs(delta) < MOTION_HEADER_DIRECTION_TOLERANCE) return;

      const retainedHeight = hasDynamicSection
        ? Math.max(0, headerHeight.get() - current.threshold)
        : headerHeight.get();
      revealProgress.set(
        Math.min(
          1,
          Math.max(
            0,
            revealProgress.get() - delta / Math.max(1, retainedHeight),
          ),
        ),
      );
    },
    [headerHeight, progress, progressThreshold, revealProgress, scrollY],
  );

  const headerStyle = useAnimatedStyle(() => {
    const threshold = progressThreshold.get();
    const hasDynamicSection = Number.isFinite(threshold);
    const collapseDistance = hasDynamicSection ? threshold : 0;
    const retainedHeight = hasDynamicSection
      ? Math.max(0, headerHeight.get() - collapseDistance)
      : headerHeight.get();
    const directionalOffset = (1 - revealProgress.get()) * retainedHeight;
    return {
      transform: [
        {
          translateY: -progress.get() * collapseDistance - directionalOffset,
        },
      ],
      zIndex: 30,
    };
  }, [headerHeight, progress, progressThreshold, revealProgress]);

  return (
    <HeaderMotion.Header
      onLayout={handleLayout}
      style={[styles.motionHeaderSurface, { paddingTop }, headerStyle]}
    >
      <FeedHeaderBlurSurface surfaceColor={surfaceColor} />
      {onPress ? (
        <Pressable
          accessible={false}
          testID="motion-header-scroll-to-top"
          onPress={onPress}
        >
          {children}
        </Pressable>
      ) : (
        children
      )}
    </HeaderMotion.Header>
  );
}

export function FeedMotionHeader({
  children,
  chromeProps,
  pressToTop = false,
  surfaceColor,
}: {
  children: ReactNode;
  chromeProps: FeedMotionChromeProps;
  pressToTop?: boolean;
  surfaceColor: string;
}) {
  return (
    <MotionHeader
      onPress={pressToTop ? chromeProps.scrollToTop : undefined}
      paddingTop={0}
      scrollY={chromeProps.scrollY}
      surfaceColor={surfaceColor}
    >
      {children}
    </MotionHeader>
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
  motionHeaderPressToTop = false,
  motionHeaderOverlaysContent = false,
  motionHeaderSurfaceColor,
  motionScrollId,
  motionChromeRef,
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
  screenActive = visible,
  pullToRefresh = false,
  bottom = false,
  bottomAutoScroll = true,
  disableMaintainVisibleContentPosition = false,
  unwrappedMotionContent = false,
  maintainVisibleContentMinIndex = 0,
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
  const [motionAnchorReady, setMotionAnchorReady] = useState(false);
  const listRef = useAnimatedRef<ScrollView>();
  const bottomListRef = useRef<FlashListRef<T>>(null);
  const insets = useSafeAreaInsets();
  const theme = useAppTheme();
  const lastOffsetRef = useRef(0);
  const anchorReadyFrameRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const anchorReadyScheduledRef = useRef(false);
  const scrollViewportHeightRef = useRef(0);
  const scrollContentHeightRef = useRef(0);
  const nearBottomTriggeredRef = useRef(false);
  const lastItemsLengthRef = useRef(items.length);
  const rowViewportStoresRef = useRef(new Map<string, FeedViewportStore>());
  const didInitialBottomScrollRef = useRef(false);
  const [bottomVisibleIndexes, setBottomVisibleIndexes] = useState<
    ReadonlySet<number>
  >(() => new Set());
  const stickyReveal = useSharedValue(0);
  const stickyHeight = useSharedValue(88);
  const footerVisible = useSharedValue(1);
  const scrollY = useSharedValue(0);
  const animatedStart = useSharedValue(0);
  const animatedDown = useSharedValue(true);
  const animatedNearTop = useSharedValue(true);
  const animatedLastDirectionOffset = useSharedValue(0);
  const animatedLastStickyOffset = useSharedValue(0);
  const animatedViewportHeight = useSharedValue(0);
  const animatedContentHeight = useSharedValue(0);
  const animatedNearBottomTriggered = useSharedValue(false);
  const topInset = getFeedTopInset(insets.top);
  const refreshInset = headerSafeArea ? topInset : 0;
  const headerSafeAreaTop = headerSafeArea ? topInset : 0;
  const outerHeaderSafeAreaTop = headerOwnsSafeArea ? 0 : headerSafeAreaTop;
  const innerHeaderSafeAreaTop = headerOwnsSafeArea ? headerSafeAreaTop : 0;
  const refreshColor = getRefreshControlColor(theme);
  const usesMotionHeader = Boolean(motionHeader || motionScrollId);
  const listItems = useMemo(() => items, [items]);
  const virtualRows = useMemo<FeedVirtualRow<T>[]>(() => {
    const columns = Math.max(1, numColumns);
    const rows: FeedVirtualRow<T>[] = [];
    const activeRowKeys = new Set<string>();
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
      const key = rowItems.map(item => item.key).join(':');
      activeRowKeys.add(key);
      const viewport =
        rowViewportStoresRef.current.get(key) ?? createFeedViewportStore();
      rowViewportStoresRef.current.set(key, viewport);
      rows.push({
        key,
        items: rowItems,
        viewport,
      });
    }
    for (const key of rowViewportStoresRef.current.keys()) {
      if (!activeRowKeys.has(key)) {
        rowViewportStoresRef.current.delete(key);
      }
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
      bottomListRef.current?.scrollToOffset({ offset: 0, animated: true });
    } else {
      listRef.current?.scrollTo({ y: 0, animated: true });
    }
  }, [bottom, listRef]);

  const scrollToBottom = useCallback(
    (animated: boolean) => {
      if (bottom) {
        bottomListRef.current?.scrollToOffset({ offset: 0, animated });
      } else {
        listRef.current?.scrollToEnd({ animated });
      }
    },
    [bottom, listRef],
  );

  const chromeProps = useMemo(
    () => ({
      visible: screenActive,
      scrolled: start >= 1,
      scrollY,
      safeAreaTop: innerHeaderSafeAreaTop,
      start,
      scrollToTop,
    }),
    [innerHeaderSafeAreaTop, screenActive, scrollToTop, scrollY, start],
  );

  useImperativeHandle(
    motionChromeRef,
    () => ({
      safeAreaTop: chromeProps.safeAreaTop,
      scrollToTop: chromeProps.scrollToTop,
      scrollY: chromeProps.scrollY,
      visible: chromeProps.visible,
    }),
    [
      chromeProps.safeAreaTop,
      chromeProps.scrollToTop,
      chromeProps.scrollY,
      chromeProps.visible,
    ],
  );

  useEffect(() => {
    if (start === 0 || items.length < lastItemsLengthRef.current) {
      nearBottomTriggeredRef.current = false;
      animatedNearBottomTriggered.set(false);
    }
    lastItemsLengthRef.current = items.length;
  }, [animatedNearBottomTriggered, items.length, start]);

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
    stickyReveal.set(0);
    animatedLastDirectionOffset.set(0);
    animatedLastStickyOffset.set(0);
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ y: 0, animated: false });
      setDown(true);
    });
  }, [
    animatedLastDirectionOffset,
    animatedLastStickyOffset,
    bottom,
    listRef,
    resetScrollKey,
    stickyReveal,
  ]);

  useEffect(() => {
    if (scrollToTopKey === undefined) return;
    stickyReveal.set(0);
    animatedLastDirectionOffset.set(0);
    animatedLastStickyOffset.set(0);
    requestAnimationFrame(() => {
      scrollToTop();
      lastOffsetRef.current = 0;
      setDown(true);
    });
  }, [
    animatedLastDirectionOffset,
    animatedLastStickyOffset,
    scrollToTop,
    scrollToTopKey,
    stickyReveal,
  ]);

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
    onViewportStateChange?.({ start, down });
  }, [down, onViewportStateChange, start]);

  const syncAnimatedViewportState = useCallback(
    (nextStart: number, nextDown: boolean, nextNearTop: boolean) => {
      setStart(current => (current === nextStart ? current : nextStart));
      setDown(current => (current === nextDown ? current : nextDown));
      setNearTop(current => (current === nextNearTop ? current : nextNearTop));
    },
    [],
  );

  useAnimatedReaction(
    () => ({
      start: animatedStart.get(),
      down: animatedDown.get(),
      nearTop: animatedNearTop.get(),
    }),
    (current, previous) => {
      if (
        previous &&
        current.start === previous.start &&
        current.down === previous.down &&
        current.nearTop === previous.nearTop
      ) {
        return;
      }

      scheduleOnRN(
        syncAnimatedViewportState,
        current.start,
        current.down,
        current.nearTop,
      );
    },
    [animatedDown, animatedNearTop, animatedStart, syncAnimatedViewportState],
  );

  useAnimatedReaction(
    () => ({
      down: animatedDown.get(),
      nearTop: animatedNearTop.get(),
      start: animatedStart.get(),
    }),
    current => {
      if (current.nearTop || current.start < 1) {
        stickyReveal.set(
          withTiming(0, {
            duration: 220,
            reduceMotion: ReduceMotion.System,
          }),
        );
      }
      footerVisible.set(
        withTiming(
          bottom || stickyFooterVisible || !current.down || current.start < 1
            ? 1
            : 0,
          { duration: 220, reduceMotion: ReduceMotion.System },
        ),
      );
    },
    [
      animatedDown,
      animatedNearTop,
      animatedStart,
      bottom,
      footerVisible,
      stickyFooterVisible,
      stickyReveal,
    ],
  );

  const stickyHeaderStyle = useAnimatedStyle(
    () => ({
      opacity: stickyReveal.get(),
      backgroundColor: stickyHeaderSafeAreaColor ?? theme.colors.base300,
      paddingTop: outerHeaderSafeAreaTop,
      transform: [
        { translateY: (stickyReveal.get() - 1) * stickyHeight.get() },
      ],
    }),
    [outerHeaderSafeAreaTop, stickyHeaderSafeAreaColor, theme.colors.base300],
  );

  const handleStickyLayout = useCallback(
    (event: LayoutChangeEvent) => {
      stickyHeight.set(event.nativeEvent.layout.height);
    },
    [stickyHeight],
  );

  const stickyFooterStyle = useAnimatedStyle(() => ({
    opacity: footerVisible.get(),
    paddingBottom: insets.bottom,
    transform: [
      { translateY: (1 - footerVisible.get()) * (88 + insets.bottom) },
    ],
  }));

  const handleViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      const indexes = viewableItems
        .map(item => item.index)
        .filter((index): index is number => typeof index === 'number')
        .sort((a, b) => a - b);
      if (!indexes.length) {
        setBottomVisibleIndexes(previous =>
          previous.size ? new Set() : previous,
        );
        return;
      }
      setBottomVisibleIndexes(previous => {
        if (
          previous.size === indexes.length &&
          indexes.every(index => previous.has(index))
        ) {
          return previous;
        }
        return new Set(indexes);
      });
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

  const maybeTriggerNearBottom = useCallback(
    (distance: number, offset: number) => {
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
      onNearBottom({ distance: Math.max(0, distance) });
    },
    [items.length, nearBottomThreshold, onNearBottom],
  );

  const handleBottomScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } =
        event.nativeEvent;
      const offset = contentOffset.y;
      scrollY.set(offset);
      scrollViewportHeightRef.current = layoutMeasurement.height;
      scrollContentHeightRef.current = contentSize.height;
      setStart(offset >= 1 ? 1 : 0);
      setNearTop(offset < STICKY_HEADER_HIDE_OFFSET);
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
    },
    [maybeTriggerNearBottom, nearBottomThreshold, scrollY],
  );

  const triggerNearBottomFromUI = useCallback(
    (distance: number) => {
      onNearBottom?.({ distance: Math.max(0, distance) });
    },
    [onNearBottom],
  );
  const hasItems = items.length > 0;
  const hasNearBottomHandler = Boolean(onNearBottom);

  useAnimatedReaction(
    () => {
      const offset = scrollY.get();
      const distance = Math.max(
        0,
        animatedContentHeight.get() - animatedViewportHeight.get() - offset,
      );
      return {
        distance,
        eligible:
          !bottom &&
          hasNearBottomHandler &&
          hasItems &&
          offset > 0 &&
          distance <= nearBottomThreshold,
      };
    },
    current => {
      if (!current.eligible) {
        animatedNearBottomTriggered.set(false);
        return;
      }
      if (animatedNearBottomTriggered.get()) return;
      animatedNearBottomTriggered.set(true);
      scheduleOnRN(triggerNearBottomFromUI, current.distance);
    },
    [
      animatedContentHeight,
      animatedNearBottomTriggered,
      animatedViewportHeight,
      bottom,
      hasItems,
      hasNearBottomHandler,
      nearBottomThreshold,
      scrollY,
      triggerNearBottomFromUI,
    ],
  );

  const handleAnimatedScroll = useAnimatedScrollHandler(
    event => {
      'worklet';
      const offset = event.contentOffset.y;
      scrollY.set(offset);
      animatedViewportHeight.set(event.layoutMeasurement.height);
      animatedContentHeight.set(event.contentSize.height);
      animatedStart.set(offset >= 1 ? 1 : 0);
      animatedNearTop.set(offset < STICKY_HEADER_HIDE_OFFSET);

      const stickyDelta = offset - animatedLastStickyOffset.get();
      animatedLastStickyOffset.set(offset);
      if (offset <= STICKY_HEADER_HIDE_OFFSET + stickyHeight.get()) {
        stickyReveal.set(0);
      } else {
        stickyReveal.set(
          Math.min(
            1,
            Math.max(0, stickyReveal.get() - stickyDelta / stickyHeight.get()),
          ),
        );
      }

      const directionDelta = offset - animatedLastDirectionOffset.get();
      if (Math.abs(directionDelta) > 4) {
        animatedDown.set(directionDelta > 0);
        animatedLastDirectionOffset.set(offset);
      }
    },
    [
      animatedContentHeight,
      animatedDown,
      animatedLastDirectionOffset,
      animatedLastStickyOffset,
      animatedNearTop,
      animatedStart,
      animatedViewportHeight,
      scrollY,
      stickyHeight,
      stickyReveal,
    ],
  );

  // The motion header offset starts at paddingTop: 0 and is applied once the
  // header measures itself, one or two frames after the first content layout.
  // Latch maintainVisibleContentPosition on only after that has landed so the
  // initial offset application is not compensated as if content had been
  // prepended above the anchor row.
  const scheduleMotionAnchorReady = useCallback(() => {
    if (anchorReadyScheduledRef.current) return;
    anchorReadyScheduledRef.current = true;
    anchorReadyFrameRef.current = requestAnimationFrame(() => {
      anchorReadyFrameRef.current = requestAnimationFrame(() => {
        anchorReadyFrameRef.current = null;
        setMotionAnchorReady(true);
      });
    });
  }, []);

  useEffect(
    () => () => {
      if (anchorReadyFrameRef.current) {
        cancelAnimationFrame(anchorReadyFrameRef.current);
        anchorReadyFrameRef.current = null;
      }
    },
    [],
  );

  const handleContentSizeChange = useCallback(
    (_width: number, height: number) => {
      if (!bottom) {
        animatedContentHeight.set(height);
        if (unwrappedMotionContent) scheduleMotionAnchorReady();
        return;
      }

      scrollContentHeightRef.current = height;
      const distanceFromBottom = Math.max(
        0,
        height - scrollViewportHeightRef.current - lastOffsetRef.current,
      );
      if (
        lastOffsetRef.current <= 0 ||
        distanceFromBottom > nearBottomThreshold
      ) {
        nearBottomTriggeredRef.current = false;
      }
      maybeTriggerNearBottom(distanceFromBottom, lastOffsetRef.current);
    },
    [
      animatedContentHeight,
      bottom,
      maybeTriggerNearBottom,
      nearBottomThreshold,
      scheduleMotionAnchorReady,
      unwrappedMotionContent,
    ],
  );

  const keyExtractor = useCallback(
    (item: T, index: number) => String(getItemId(item, index)),
    [getItemId],
  );
  const renderBottomItem = useCallback(
    (info: FlashListRenderItemInfo<T>) => (
      <MediaActivityProvider
        active={screenActive && bottomVisibleIndexes.has(info.index)}
      >
        {renderItem({
          item: info.item,
          index: info.index,
          extraData: info.extraData,
          data: items,
          visible,
        })}
      </MediaActivityProvider>
    ),
    [bottomVisibleIndexes, items, renderItem, screenActive, visible],
  );
  const handleEndReached = useCallback(
    (event?: { distanceFromEnd?: number }) => {
      if (
        !onNearBottom ||
        items.length === 0 ||
        start === 0 ||
        nearBottomTriggeredRef.current
      ) {
        return;
      }
      nearBottomTriggeredRef.current = true;
      onNearBottom({ distance: Math.max(0, event?.distanceFromEnd ?? 0) });
    },
    [items.length, onNearBottom, start],
  );

  const renderVirtualRowContent = useCallback(
    (row: FeedVirtualRow<T>) => (
      <FeedVirtualRowContent
        columnWrapperStyle={columnWrapperStyle}
        data={items}
        numColumns={numColumns}
        renderItem={renderItem}
        row={row}
        visible={visible}
        screenActive={screenActive}
      />
    ),
    [columnWrapperStyle, items, numColumns, renderItem, screenActive, visible],
  );
  const handleVirtualRowModeChange = useCallback(
    (row: FeedVirtualRow<T>, _key: string, event: FeedModeChangeEvent) => {
      row.viewport.setMode(event.mode);
    },
    [],
  );

  const showCustomRefreshIndicator =
    !bottom && !usesMotionHeader && pullToRefresh && !!onRefresh && refreshing;
  const customRefreshInset = usesMotionHeader ? 0 : refreshInset;
  const listHeader = useMemo(() => {
    if (!header && !showCustomRefreshIndicator) return null;
    const inFlowChromeProps =
      showCustomRefreshIndicator || usesMotionHeader
        ? { ...chromeProps, safeAreaTop: 0 }
        : chromeProps;
    const inFlowHeaderPaddingTop =
      showCustomRefreshIndicator || usesMotionHeader
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
              backgroundColor: theme.colors.base300,
              paddingTop: inFlowHeaderPaddingTop,
            }}
          >
            {header({ ...inFlowChromeProps, scrolled: false })}
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
    theme.colors.base300,
    usesMotionHeader,
  ]);

  const listFooter = useMemo(() => {
    if (!footer) return null;
    return <View className="w-full">{footer(chromeProps)}</View>;
  }, [chromeProps, footer]);

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View className="px-6 py-14">
          <Text className="text-center text-base text-primary-content">
            Loading...
          </Text>
        </View>
      );
    }
    return empty ? <View className="px-6 py-12">{empty}</View> : null;
  }, [empty, loading]);
  const stickyContent = stickyHeader ? stickyHeader(chromeProps) : null;
  const feedContent = (
    <View
      collapsable={false}
      className="relative flex-1"
      style={{ backgroundColor: theme.colors.base100 }}
    >
      {bottom ? (
        <FlashList
          ref={bottomListRef}
          alwaysBounceVertical
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
              : { disabled: true }
          }
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.35}
          onScroll={handleBottomScroll}
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
      ) : usesMotionHeader && unwrappedMotionContent ? (
        <HeaderMotion.ScrollManager
          scrollId={motionScrollId}
          animatedRef={listRef as never}
          onScroll={handleAnimatedScroll}
          refreshControl={
            pullToRefresh && onRefresh ? (
              <RefreshControl
                colors={[refreshColor]}
                progressBackgroundColor={theme.colors.base200}
                refreshing={refreshing}
                tintColor={refreshColor}
                onRefresh={onRefresh}
              />
            ) : undefined
          }
          refreshing={refreshing}
          onRefresh={onRefresh}
        >
          {(scrollableProps, { originalHeaderHeight }) => (
            <Animated.ScrollView
              {...(scrollableProps as unknown as Pick<
                React.ComponentProps<typeof Animated.ScrollView>,
                'onLayout' | 'onScroll' | 'refreshControl' | 'ref'
              >)}
              alwaysBounceVertical
              className="flex-1"
              contentInsetAdjustmentBehavior="never"
              contentContainerClassName={contentContainerClassName}
              contentContainerStyle={
                motionHeaderOverlaysContent
                  ? undefined
                  : { paddingTop: originalHeaderHeight }
              }
              maintainVisibleContentPosition={
                shouldMaintainVisibleContentPosition &&
                !showCustomRefreshIndicator &&
                motionAnchorReady
                  ? { minIndexForVisible: maintainVisibleContentMinIndex }
                  : undefined
              }
              onContentSizeChange={handleContentSizeChange}
              scrollEventThrottle={16}
            >
              {listHeader}
              {items.length === 0 ? (
                listEmpty
              ) : (
                <VirtualColumn
                  items={virtualRowsCollection}
                  itemToKey={row => row.key}
                  onItemModeChange={handleVirtualRowModeChange}
                  removeClippedSubviews={removeClippedSubviews}
                  testID={`feed-virtual-column:${numColumns}`}
                >
                  {renderVirtualRowContent}
                </VirtualColumn>
              )}
              {listFooter}
            </Animated.ScrollView>
          )}
        </HeaderMotion.ScrollManager>
      ) : usesMotionHeader ? (
        <HeaderMotion.ScrollView
          animatedRef={listRef as never}
          alwaysBounceVertical
          className="flex-1"
          contentInsetAdjustmentBehavior="never"
          contentContainerClassName={contentContainerClassName}
          headerOffsetStrategy={
            motionHeaderOverlaysContent ? 'none' : undefined
          }
          scrollId={motionScrollId}
          maintainVisibleContentPosition={
            shouldMaintainVisibleContentPosition && !showCustomRefreshIndicator
              ? { minIndexForVisible: 0 }
              : undefined
          }
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleAnimatedScroll}
          refreshControl={
            pullToRefresh && onRefresh ? (
              <RefreshControl
                colors={[refreshColor]}
                progressBackgroundColor={theme.colors.base200}
                refreshing={refreshing}
                tintColor={refreshColor}
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
              onItemModeChange={handleVirtualRowModeChange}
              removeClippedSubviews={removeClippedSubviews}
              testID={`feed-virtual-column:${numColumns}`}
            >
              {renderVirtualRowContent}
            </VirtualColumn>
          )}
          {listFooter}
        </HeaderMotion.ScrollView>
      ) : (
        <Animated.ScrollView
          ref={listRef}
          alwaysBounceVertical
          className="flex-1"
          contentInsetAdjustmentBehavior="never"
          contentContainerClassName={contentContainerClassName}
          maintainVisibleContentPosition={
            shouldMaintainVisibleContentPosition && !showCustomRefreshIndicator
              ? { minIndexForVisible: 0 }
              : undefined
          }
          onContentSizeChange={handleContentSizeChange}
          onScroll={handleAnimatedScroll}
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
              onItemModeChange={handleVirtualRowModeChange}
              removeClippedSubviews={removeClippedSubviews}
              testID={`feed-virtual-column:${numColumns}`}
            >
              {renderVirtualRowContent}
            </VirtualColumn>
          )}
          {listFooter}
        </Animated.ScrollView>
      )}
      {motionHeader ? (
        <MotionHeader
          onPress={motionHeaderPressToTop ? scrollToTop : undefined}
          paddingTop={outerHeaderSafeAreaTop}
          scrollY={scrollY}
          surfaceColor={motionHeaderSurfaceColor ?? theme.colors.base300}
        >
          {motionHeader(chromeProps)}
        </MotionHeader>
      ) : null}
      {stickyContent ? (
        <Animated.View
          pointerEvents={start >= 1 && !down && !nearTop ? 'auto' : 'none'}
          className="absolute left-0 right-0 top-0 z-30"
          onLayout={handleStickyLayout}
          style={stickyHeaderStyle}
        >
          <Pressable onPress={scrollToTop}>{stickyContent}</Pressable>
        </Animated.View>
      ) : null}
      {stickyFooter ? (
        <Animated.View
          pointerEvents="box-none"
          className="absolute bottom-0 left-0 right-0 z-30"
          style={stickyFooterStyle}
        >
          {stickyFooter(chromeProps)}
        </Animated.View>
      ) : null}
    </View>
  );

  return motionHeader ? (
    <HeaderMotion measureDynamicMode="update">{feedContent}</HeaderMotion>
  ) : (
    feedContent
  );
}
