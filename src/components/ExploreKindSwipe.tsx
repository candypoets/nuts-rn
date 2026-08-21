import React, {type ReactNode, useCallback, useEffect, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import * as Haptics from 'expo-haptics';
import PagerView, {
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';
import Reanimated, {
  type SharedValue,
  useEvent,
} from 'react-native-reanimated';

import type {FeedKind} from '../stores/appStore';
import type {FeedKindTab} from './FeedKindNavigator';
import {
  exploreKindsAtIndex,
  selectedExploreKindIndex,
} from './exploreKindPagerModel';

const AnimatedPagerView = Reanimated.createAnimatedComponent(PagerView);

export function ExploreKindSwipe({
  enabled = true,
  onSelectKinds,
  pageProgress,
  renderPage,
  selectedKinds,
  tabs,
}: {
  enabled?: boolean;
  onSelectKinds: (kinds: FeedKind[]) => void;
  pageProgress: SharedValue<number>;
  renderPage: (params: {
    id: FeedKindTab['id'];
    index: number;
    isActive: boolean;
    kinds: FeedKind[];
  }) => ReactNode;
  selectedKinds: FeedKind[];
  tabs: FeedKindTab[];
}) {
  const pagerRef = useRef<PagerView>(null);
  const selectedIndex = selectedExploreKindIndex(selectedKinds, tabs);
  const selectedIndexRef = useRef(selectedIndex);

  useEffect(() => {
    if (selectedIndexRef.current === selectedIndex) return;
    selectedIndexRef.current = selectedIndex;
    pageProgress.set(selectedIndex);
    pagerRef.current?.setPageWithoutAnimation(selectedIndex);
  }, [pageProgress, selectedIndex]);

  const handlePageScroll = useEvent<{offset: number; position: number}>(
    event => {
      'worklet';
      pageProgress.set(event.position + event.offset);
    },
    ['onPageScroll'],
  );

  const handlePageSelected = useCallback(
    (event: PagerViewOnPageSelectedEvent) => {
      const index = event.nativeEvent.position;
      if (index === selectedIndexRef.current) return;
      const kinds = exploreKindsAtIndex(tabs, index);
      if (!kinds) return;

      selectedIndexRef.current = index;
      Haptics.selectionAsync().catch(() => {});
      onSelectKinds(kinds);
    },
    [onSelectKinds, tabs],
  );

  return (
    <AnimatedPagerView
      ref={pagerRef}
      style={styles.pager}
      initialPage={selectedIndex}
      scrollEnabled={enabled && tabs.length > 1}
      offscreenPageLimit={Math.max(1, tabs.length - 1)}
      overScrollMode="never"
      onPageScroll={handlePageScroll as never}
      onPageSelected={handlePageSelected}
    >
      {tabs.map((tab, index) => {
        const kinds = tab.kinds ?? [];
        return (
          <View
            key={tab.id}
            collapsable={false}
            style={styles.page}
            testID={`explore-kind-page-${tab.id}`}
          >
            {renderPage({
              id: tab.id,
              index,
              isActive: index === selectedIndex,
              kinds,
            })}
          </View>
        );
      })}
    </AnimatedPagerView>
  );
}

const styles = StyleSheet.create({
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});
