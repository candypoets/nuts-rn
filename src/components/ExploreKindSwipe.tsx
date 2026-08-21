import React, {type ReactNode, useCallback, useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import * as Haptics from 'expo-haptics';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import {scheduleOnRN} from 'react-native-worklets';

import type {FeedKind} from '../stores/appStore';
import {
  selectedFeedKindTab,
  type FeedKindTab,
} from './FeedKindNavigator';

const SWIPE_COMMIT_DISTANCE = 96;
const SWIPE_DECELERATION_RATE = 0.998;

export type ExploreKindSwipeDirection = -1 | 1;

function projectedDistance(translationX: number, velocityX: number) {
  'worklet';
  const momentum =
    ((velocityX / 1000) * SWIPE_DECELERATION_RATE) /
    (1 - SWIPE_DECELERATION_RATE);
  return translationX + momentum;
}

/** A leftward swipe selects the next tab; a rightward swipe selects the previous. */
export function exploreKindSwipeDirection(
  translationX: number,
  velocityX: number,
): ExploreKindSwipeDirection | 0 {
  'worklet';
  const projected = projectedDistance(translationX, velocityX);
  if (projected <= -SWIPE_COMMIT_DISTANCE) return 1;
  if (projected >= SWIPE_COMMIT_DISTANCE) return -1;
  return 0;
}

export function adjacentExploreKinds(
  selectedKinds: FeedKind[],
  tabs: FeedKindTab[],
  direction: ExploreKindSwipeDirection,
): FeedKind[] | null {
  const selectedId = selectedFeedKindTab(selectedKinds, tabs);
  const selectedIndex = tabs.findIndex(tab => tab.id === selectedId);
  const nextTab = tabs[selectedIndex + direction];
  return nextTab ? [...(nextTab.kinds ?? [])] : null;
}

export function ExploreKindSwipe({
  children,
  enabled = true,
  onSelectKinds,
  selectedKinds,
  tabs,
}: {
  children: ReactNode;
  enabled?: boolean;
  onSelectKinds: (kinds: FeedKind[]) => void;
  selectedKinds: FeedKind[];
  tabs: FeedKindTab[];
}) {
  const commitSwipe = useCallback(
    (direction: ExploreKindSwipeDirection) => {
      const nextKinds = adjacentExploreKinds(selectedKinds, tabs, direction);
      if (!nextKinds) return;
      Haptics.selectionAsync().catch(() => {});
      onSelectKinds(nextKinds);
    },
    [onSelectKinds, selectedKinds, tabs],
  );
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(enabled && tabs.length > 1)
        .activeOffsetX([-24, 24])
        .failOffsetY([-18, 18])
        .onEnd(event => {
          const direction = exploreKindSwipeDirection(
            event.translationX,
            event.velocityX,
          );
          if (direction) scheduleOnRN(commitSwipe, direction);
        }),
    [commitSwipe, enabled, tabs.length],
  );

  return (
    <GestureDetector gesture={swipeGesture}>
      <View style={styles.container}>{children}</View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
