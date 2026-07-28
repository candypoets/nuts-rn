import {pushDistinct} from './pushDistinct';
import type {AppNavigationProp} from './types';

export function handleProfileRoute(
  route: string,
  navigation: AppNavigationProp,
) {
  if (!route.startsWith('profile:')) return false;

  const pubkey = route.slice('profile:'.length);
  if (!pubkey) return true;

  pushDistinct(navigation, 'PublicProfile', {pubkey});
  return true;
}
