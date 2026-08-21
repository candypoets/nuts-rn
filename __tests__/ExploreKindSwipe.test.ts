import {
  adjacentExploreKinds,
  exploreKindSwipeDirection,
} from '../src/components/ExploreKindSwipe';
import type {FeedKindTab} from '../src/components/FeedKindNavigator';

const TABS: FeedKindTab[] = [
  {id: 'notes', label: 'Notes', kinds: [1, 6, 1068]},
  {id: 'media', label: 'Media', kinds: [20, 22]},
  {id: 'articles', label: 'Articles', kinds: [30023]},
  {id: 'events', label: 'Events', kinds: [31922, 31923]},
];

describe('Explore kind swipes', () => {
  it('moves leftward through the configured kind order', () => {
    expect(adjacentExploreKinds([1, 6, 1068], TABS, 1)).toEqual([20, 22]);
    expect(adjacentExploreKinds([20, 22], TABS, 1)).toEqual([30023]);
  });

  it('moves rightward and stops at the first and last kind', () => {
    expect(adjacentExploreKinds([20, 22], TABS, -1)).toEqual([1, 6, 1068]);
    expect(adjacentExploreKinds([1, 6, 1068], TABS, -1)).toBeNull();
    expect(adjacentExploreKinds([31922, 31923], TABS, 1)).toBeNull();
  });

  it('accepts either a deliberate drag or a short fast flick', () => {
    expect(exploreKindSwipeDirection(-110, 0)).toBe(1);
    expect(exploreKindSwipeDirection(-20, -700)).toBe(1);
    expect(exploreKindSwipeDirection(110, 0)).toBe(-1);
    expect(exploreKindSwipeDirection(20, 700)).toBe(-1);
    expect(exploreKindSwipeDirection(40, 0)).toBe(0);
  });
});
