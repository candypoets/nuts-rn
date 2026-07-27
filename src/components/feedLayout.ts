const TOP_SAFE_AREA_OFFSET = 8;

export function getFeedTopInset(safeAreaTop: number) {
  return Math.max(0, safeAreaTop - TOP_SAFE_AREA_OFFSET);
}
