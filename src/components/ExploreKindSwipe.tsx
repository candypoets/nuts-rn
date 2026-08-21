import React, {type ReactNode, useCallback, useEffect, useRef} from 'react';
import {StyleSheet, View} from 'react-native';
import * as Haptics from 'expo-haptics';
import PagerView, {
  type PagerViewOnPageSelectedEvent,
} from 'react-native-pager-view';

import type {FeedKind} from '../stores/appStore';
import type {FeedKindTab} from './FeedKindNavigator';
import {
  exploreKindsAtIndex,
  selectedExploreKindIndex,
} from './exploreKindPagerModel';

export function ExploreKindSwipe({
  enabled = true,
  onSelectKinds,
  renderPage,
  selectedKinds,
  tabs,
}: {
  enabled?: boolean;
  onSelectKinds: (kinds: FeedKind[]) => void;
  renderPage: (params: {
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
    pagerRef.current?.setPageWithoutAnimation(selectedIndex);
  }, [selectedIndex]);

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
    <PagerView
      ref={pagerRef}
      style={styles.pager}
      initialPage={selectedIndex}
      scrollEnabled={enabled && tabs.length > 1}
      offscreenPageLimit={Math.max(1, tabs.length - 1)}
      overScrollMode="never"
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
              index,
              isActive: index === selectedIndex,
              kinds,
            })}
          </View>
        );
      })}
    </PagerView>
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
