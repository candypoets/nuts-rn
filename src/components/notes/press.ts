export const TAP_MOVE_THRESHOLD = 8;
const RECENT_SWIPE_WINDOW_MS = 250;

let lastSwipeEndAt = 0;

export function markSwipeGestureEnd() {
  lastSwipeEndAt = Date.now();
}

export function wasRecentSwipeGesture() {
  return Date.now() - lastSwipeEndAt < RECENT_SWIPE_WINDOW_MS;
}

export function movedTooFar(
  start: {x: number; y: number} | null,
  end: {x: number; y: number},
) {
  if (!start) return true;
  return (
    Math.abs(end.x - start.x) > TAP_MOVE_THRESHOLD ||
    Math.abs(end.y - start.y) > TAP_MOVE_THRESHOLD
  );
}
