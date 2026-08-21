import {
  exploreKindsAtIndex,
  selectedExploreKindIndex,
} from '../src/components/exploreKindPagerModel';
import type {FeedKindTab} from '../src/components/FeedKindNavigator';

const TABS: FeedKindTab[] = [
  {id: 'notes', label: 'Notes', kinds: [1, 6, 1068]},
  {id: 'media', label: 'Media', kinds: [20, 22]},
  {id: 'articles', label: 'Articles', kinds: [30023]},
  {id: 'events', label: 'Events', kinds: [31922, 31923]},
];

describe('Explore kind swipes', () => {
  it('maps each retained pager surface to its configured kinds', () => {
    expect(exploreKindsAtIndex(TABS, 0)).toEqual([1, 6, 1068]);
    expect(exploreKindsAtIndex(TABS, 1)).toEqual([20, 22]);
    expect(exploreKindsAtIndex(TABS, 2)).toEqual([30023]);
    expect(exploreKindsAtIndex(TABS, 3)).toEqual([31922, 31923]);
  });

  it('maps the selected kind set back to the native page index', () => {
    expect(selectedExploreKindIndex([1, 6, 1068], TABS)).toBe(0);
    expect(selectedExploreKindIndex([20, 22], TABS)).toBe(1);
    expect(selectedExploreKindIndex([30023], TABS)).toBe(2);
    expect(selectedExploreKindIndex([31922, 31923], TABS)).toBe(3);
  });

  it('falls back safely for unknown selections and page indexes', () => {
    expect(selectedExploreKindIndex([], TABS)).toBe(0);
    expect(exploreKindsAtIndex(TABS, -1)).toBeNull();
    expect(exploreKindsAtIndex(TABS, TABS.length)).toBeNull();
  });
});
