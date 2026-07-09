export const TAP_MOVE_THRESHOLD = 8;

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
