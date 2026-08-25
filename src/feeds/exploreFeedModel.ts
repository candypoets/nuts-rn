export const EXPLORE_MEDIA_GRID_COLUMNS = 3;
export const EXPLORE_MEDIA_TILE_HEIGHT_RATIO = 1.2;

export function shouldHoldExploreItem({
  itemCreatedAt,
  previouslyPresented,
  subscriptionResolving,
  topItemCreatedAt,
}: {
  itemCreatedAt: number;
  previouslyPresented: boolean;
  subscriptionResolving: boolean;
  topItemCreatedAt?: number;
}) {
  return (
    !previouslyPresented &&
    !subscriptionResolving &&
    topItemCreatedAt !== undefined &&
    itemCreatedAt > topItemCreatedAt
  );
}

export function exploreMediaTileSize(viewportWidth: number, columns: number) {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 0;
  return viewportWidth / Math.max(1, Math.floor(columns));
}

export function exploreMediaTileHeight(tileWidth: number) {
  return Math.max(0, tileWidth) * EXPLORE_MEDIA_TILE_HEIGHT_RATIO;
}
