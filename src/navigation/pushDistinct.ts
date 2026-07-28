import type {AppNavigationProp, RootStackParamList} from './types';

function sameParams(
  left: RootStackParamList[keyof RootStackParamList],
  right: RootStackParamList[keyof RootStackParamList],
) {
  if (left === right) return true;
  if (!left || !right) return false;

  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;

  return leftKeys.every((key, index) => {
    if (key !== rightKeys[index]) return false;
    return (
      left[key as keyof typeof left] === right[key as keyof typeof right]
    );
  });
}

export function pushDistinct<RouteName extends keyof RootStackParamList>(
  navigation: AppNavigationProp,
  name: RouteName,
  params: RootStackParamList[RouteName],
) {
  const routes = navigation.getState().routes;
  const current = routes[routes.length - 1];

  if (
    current?.name === name &&
    sameParams(
      current.params as RootStackParamList[keyof RootStackParamList],
      params,
    )
  ) {
    return;
  }

  const push = navigation.push as (
    routeName: RouteName,
    routeParams: RootStackParamList[RouteName],
  ) => void;
  push(name, params);
}
