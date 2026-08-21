import type {FeedKind} from '../stores/appStore';
import {
  selectedFeedKindTab,
  type FeedKindTab,
} from './FeedKindNavigator';

export function selectedExploreKindIndex(
  selectedKinds: FeedKind[],
  tabs: FeedKindTab[],
) {
  const selectedId = selectedFeedKindTab(selectedKinds, tabs);
  return Math.max(0, tabs.findIndex(tab => tab.id === selectedId));
}

export function exploreKindsAtIndex(tabs: FeedKindTab[], index: number) {
  const tab = tabs[index];
  return tab ? [...(tab.kinds ?? [])] : null;
}
