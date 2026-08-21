import React, {useEffect, useRef, useState} from 'react';
import {InteractionManager, View} from 'react-native';
import type {SharedValue} from 'react-native-reanimated';
import {type FeedKind} from '../stores';
import {SegmentedTabs, type SegmentedTab} from './SegmentedTabs';

export type FeedKindTabId =
  | 'notes'
  | 'media'
  | 'polls'
  | 'articles'
  | 'events';

export type FeedKindTab = SegmentedTab<FeedKindTabId> & {
  kinds?: FeedKind[];
};

export const FEED_KIND_TABS: FeedKindTab[] = [
  {id: 'notes', label: 'Notes', kinds: [1, 6]},
  {id: 'media', label: 'Media', kinds: [20, 22]},
  {id: 'polls', label: 'Polls', kinds: [1068]},
  {id: 'articles', label: 'Articles', kinds: [30023]},
];

function sameKinds(left: FeedKind[], right: FeedKind[]) {
  if (left.length !== right.length) return false;
  return left.every((kind, index) => kind === right[index]);
}

export function selectedFeedKindTab(
  selectedKinds: FeedKind[],
  tabs: FeedKindTab[] = FEED_KIND_TABS,
): FeedKindTabId {
  if (selectedKinds.length === 0) {
    return tabs[0]?.id ?? 'notes';
  }

  return (
    tabs.find(tab => (tab.kinds ? sameKinds(selectedKinds, tab.kinds) : false))
      ?.id ?? tabs[0]?.id ?? 'notes'
  );
}

export function FeedKindNavigator({
  selectedKinds,
  onSelectKinds,
  tabs = FEED_KIND_TABS,
  deferSelection = false,
  selectionProgress,
}: {
  selectedKinds: FeedKind[];
  onSelectKinds: (kinds: FeedKind[]) => void;
  tabs?: FeedKindTab[];
  deferSelection?: boolean;
  selectionProgress?: SharedValue<number>;
}) {
  const selectedIdFromStore = selectedFeedKindTab(selectedKinds, tabs);
  const [optimisticSelectedId, setOptimisticSelectedId] =
    useState<FeedKindTabId>(selectedIdFromStore);
  const pendingSelectionRef = useRef<ReturnType<
    typeof InteractionManager.runAfterInteractions
  > | null>(null);

  useEffect(() => {
    setOptimisticSelectedId(selectedIdFromStore);
  }, [selectedIdFromStore]);

  useEffect(
    () => () => {
      pendingSelectionRef.current?.cancel();
      pendingSelectionRef.current = null;
    },
    [],
  );

  return (
    <View className="w-full">
      <SegmentedTabs
        tabs={tabs}
        selectedId={optimisticSelectedId}
        onSelect={id => {
          const tab = tabs.find(item => item.id === id);
          const nextKinds = tab?.kinds ?? [];
          setOptimisticSelectedId(id);
          pendingSelectionRef.current?.cancel();
          if (!deferSelection) {
            onSelectKinds(nextKinds);
            return;
          }
          pendingSelectionRef.current = InteractionManager.runAfterInteractions(
            () => {
              pendingSelectionRef.current = null;
              onSelectKinds(nextKinds);
            },
          );
        }}
        layout="adaptive"
        labelWeight="regular"
        selectionProgress={selectionProgress}
      />
    </View>
  );
}
