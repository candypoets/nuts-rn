import type {ImperativeRouter} from 'expo-router';
import {pushDistinct} from './pushDistinct';

export function handleProfileRoute(
  route: string,
  router: ImperativeRouter,
) {
  if (!route.startsWith('profile:')) return false;

  const pubkey = route.slice('profile:'.length);
  if (!pubkey) return true;

  pushDistinct(router, {pathname: '/PublicProfile', params: {pubkey}});
  return true;
}
