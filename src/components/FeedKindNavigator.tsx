import React, {useEffect, useRef, useState} from 'react';
import {InteractionManager, View} from 'react-native';
import {ALL_FEED_KINDS, type FeedKind} from '../stores';
import {SegmentedTabs, type SegmentedTab} from './SegmentedTabs';

export type FeedKindTabId =
  | 'all'
  | 'notes'
  | 'articles'
  | 'polls'
  | 'media'
  | 'events';

export type FeedKindTab = SegmentedTab<FeedKindTabId> & {
  kinds?: FeedKind[];
};

export const FEED_KIND_TABS: FeedKindTab[] = [
  {id: 'all', label: 'All'},
  {id: 'notes', label: 'Notes', kinds: [1, 6]},
  {id: 'articles', label: 'Articles', kinds: [30023]},
  {id: 'polls', label: 'Polls', kinds: [1068]},
  {id: 'media', label: 'Media', kinds: [20, 22]},
];

function sameKinds(left: FeedKind[], right: FeedKind[]) {
  if (left.length !== right.length) return false;
  return left.every((kind, index) => kind === right[index]);
}

export function selectedFeedKindTab(
  selectedKinds: FeedKind[],
  tabs: FeedKindTab[] = FEED_KIND_TABS,
): FeedKindTabId {
  if (
    selectedKinds.length === 0 ||
    sameKinds(selectedKinds, ALL_FEED_KINDS)
  ) {
    return 'all';
  }

  return (
    tabs.find(tab => (tab.kinds ? sameKinds(selectedKinds, tab.kinds) : false))
      ?.id ?? 'all'
  );
}

export function FeedKindNavigator({
  selectedKinds,
  onSelectKinds,
  tabs = FEED_KIND_TABS,
  deferSelection = false,
}: {
  selectedKinds: FeedKind[];
  onSelectKinds: (kinds: FeedKind[]) => void;
  tabs?: FeedKindTab[];
  deferSelection?: boolean;
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
        layout="scroll"
      />
    </View>
  );
}
