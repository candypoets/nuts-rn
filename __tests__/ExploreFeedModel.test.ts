import {
  EXPLORE_MEDIA_GRID_COLUMNS,
  exploreMediaTileSize,
  shouldHoldExploreItem,
} from '../src/feeds/exploreFeedModel';

describe('Explore feed new-post hold', () => {
  it('does not hold an event that was presented before a feed switch', () => {
    expect(
      shouldHoldExploreItem({
        itemCreatedAt: 200,
        previouslyPresented: true,
        subscriptionResolving: false,
        topItemCreatedAt: 100,
      }),
    ).toBe(false);
  });

  it('holds a genuinely new event delivered above the visible feed', () => {
    expect(
      shouldHoldExploreItem({
        itemCreatedAt: 200,
        previouslyPresented: false,
        subscriptionResolving: false,
        topItemCreatedAt: 100,
      }),
    ).toBe(true);
  });

  it('includes initial subscription events without holding them', () => {
    expect(
      shouldHoldExploreItem({
        itemCreatedAt: 200,
        previouslyPresented: false,
        subscriptionResolving: true,
        topItemCreatedAt: 100,
      }),
    ).toBe(false);
  });
});

describe('Explore media grid', () => {
  it('sizes each tile to exactly one third of the viewport', () => {
    expect(EXPLORE_MEDIA_GRID_COLUMNS).toBe(3);
    expect(exploreMediaTileSize(390, EXPLORE_MEDIA_GRID_COLUMNS)).toBe(130);
  });

  it('keeps a partial final row on the same grid track', () => {
    expect(exploreMediaTileSize(412, 3)).toBeCloseTo(137.333, 3);
  });
});
