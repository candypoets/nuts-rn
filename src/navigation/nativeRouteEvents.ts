import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {pushDistinct} from './pushDistinct';
import type {RootStackParamList} from './types';

export function handleProfileRoute(
  route: string,
  navigation: NativeStackNavigationProp<RootStackParamList>,
) {
  if (!route.startsWith('profile:')) return false;

  const pubkey = route.slice('profile:'.length);
  if (!pubkey) return true;

  pushDistinct(navigation, 'PublicProfile', {pubkey});
  return true;
}
