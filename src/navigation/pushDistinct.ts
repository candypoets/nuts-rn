import type {Href, ImperativeRouter} from 'expo-router';

// Ignore pushes that land too close after a previous one — almost always an
// accidental double tap. Programmatic chained pushes within this window are
// rare enough that swallowing them is the lesser evil.
const NAV_THROTTLE_MS = 500;
let lastNavAt = 0;

/**
 * Pushes an Expo Router href unless another guarded push just claimed the
 * navigation slot.
 */
export function pushDistinct(
  router: ImperativeRouter,
  href: Href,
  now: number = Date.now(),
) {
  if (now - lastNavAt < NAV_THROTTLE_MS) return;
  lastNavAt = now;
  router.push(href);
}
