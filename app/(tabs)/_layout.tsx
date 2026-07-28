import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {type ColorValue} from 'react-native';
import {Tabs} from 'expo-router';
import {useIsFocused} from 'expo-router/react-navigation';
import {House, Layers3, MessageCircle} from 'lucide-react-native';
import type {NostrManagerLike} from '@candypoets/nipworker';

import {getSharedNostrManager} from '../../src/nostr/manager';
import {getAppThemeVars, useAppTheme} from '../../src/theme';

export type RouteId = 'home' | 'explore' | 'chat';

function scheduleNostrCleanup(manager: NostrManagerLike | null, delay = 1000) {
  if (!manager) return () => {};

  const timeout = setTimeout(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        manager.cleanup();
      });
    });
  }, delay);

  return () => clearTimeout(timeout);
}

type MainTabContextValue = {
  activatedRoutes: Record<RouteId, boolean>;
  activateRoute: (routeId: RouteId) => void;
  manager: NostrManagerLike | null;
  nostrEnabled: boolean;
  themeVars: ReturnType<typeof getAppThemeVars>;
  backgroundColor: string;
};

const MainTabContext = createContext<MainTabContextValue | null>(null);

export function useMainTabContext(routeId: RouteId) {
  const context = useContext(MainTabContext);
  if (!context) {
    throw new Error('Main tab context is missing');
  }

  const isFocused = useIsFocused();

  useEffect(() => {
    if (!isFocused) return;
    context.activateRoute(routeId);
    return scheduleNostrCleanup(context.manager);
  }, [context, isFocused, routeId]);

  return {
    ...context,
    isFocused,
    visible: context.activatedRoutes[routeId],
  };
}

function tabBarIcon(routeName: string) {
  return ({color, size}: {color: ColorValue; size: number}) => {
    const Icon =
      routeName === 'HomeTab'
        ? House
        : routeName === 'ChatTab'
          ? MessageCircle
          : Layers3;
    return <Icon color={color} size={Math.min(size, 22)} strokeWidth={2} />;
  };
}

export default function MainTabsLayout() {
  const theme = useAppTheme();
  const themeVars = useMemo(() => getAppThemeVars(theme), [theme]);
  const manager = useMemo(() => getSharedNostrManager(), []);
  const nostrEnabled = Boolean(manager);

  const [activatedRoutes, setActivatedRoutes] = useState<
    Record<RouteId, boolean>
  >({
    home: false,
    explore: true,
    chat: false,
  });

  const activateRoute = useCallback((routeId: RouteId) => {
    setActivatedRoutes(current => {
      if (current[routeId]) return current;
      return {...current, [routeId]: true};
    });
  }, []);

  const tabContext = useMemo(
    () => ({
      activatedRoutes,
      activateRoute,
      manager,
      nostrEnabled,
      themeVars,
      backgroundColor: theme.colors.base100,
    }),
    [
      activateRoute,
      activatedRoutes,
      manager,
      nostrEnabled,
      theme.colors.base100,
      themeVars,
    ],
  );

  return (
    <MainTabContext.Provider value={tabContext}>
      <Tabs
        initialRouteName="ExploreTab"
        backBehavior="initialRoute"
        screenOptions={({route}) => ({
          headerShown: false,
          lazy: false,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.primaryContent,
          tabBarStyle: {
            backgroundColor: theme.colors.base100,
            borderTopColor: `${theme.colors.primaryContent}18`,
            height: 68,
            paddingBottom: 7,
            paddingTop: 7,
          },
          tabBarLabelStyle: {fontSize: 11, fontWeight: '500' as const},
          tabBarIcon: tabBarIcon(route.name),
        })}
      >
        <Tabs.Screen name="HomeTab" options={{title: 'Home'}} />
        <Tabs.Screen name="ExploreTab" options={{title: 'Feed'}} />
        <Tabs.Screen name="ChatTab" options={{title: 'Chats'}} />
      </Tabs>
    </MainTabContext.Provider>
  );
}
