import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useIsFocused } from 'expo-router/react-navigation';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import type { NostrManagerLike } from '@candypoets/nipworker';

import { getSharedNostrManager } from '../../src/nostr/manager';
import { getAppThemeVars, useAppTheme } from '../../src/theme';

export const unstable_settings = {
  initialRouteName: 'ExploreTab',
};

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
  requestScrollToTop: (routeId: RouteId) => void;
  scrollToTopKeys: Record<RouteId, number | undefined>;
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
  const { activateRoute, manager } = context;

  useEffect(() => {
    if (!isFocused) return;
    activateRoute(routeId);
    return scheduleNostrCleanup(manager);
  }, [activateRoute, isFocused, manager, routeId]);

  return {
    ...context,
    isFocused,
    scrollToTopKey: context.scrollToTopKeys[routeId],
    visible: context.activatedRoutes[routeId],
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
  const [scrollToTopKeys, setScrollToTopKeys] = useState<
    Record<RouteId, number | undefined>
  >({
    home: undefined,
    explore: undefined,
    chat: undefined,
  });

  const activateRoute = useCallback((routeId: RouteId) => {
    setActivatedRoutes(current => {
      if (current[routeId]) return current;
      return { ...current, [routeId]: true };
    });
  }, []);

  const requestScrollToTop = useCallback((routeId: RouteId) => {
    setScrollToTopKeys(current => ({
      ...current,
      [routeId]: (current[routeId] ?? 0) + 1,
    }));
  }, []);

  const tabContext = useMemo(
    () => ({
      activatedRoutes,
      activateRoute,
      requestScrollToTop,
      scrollToTopKeys,
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
      requestScrollToTop,
      scrollToTopKeys,
      theme.colors.base100,
      themeVars,
    ],
  );

  const tabPressListeners = useCallback(
    (routeId: RouteId) =>
      ({ navigation }: { navigation: { isFocused: () => boolean } }) => ({
        tabPress: () => {
          if (navigation.isFocused()) {
            requestScrollToTop(routeId);
          }
        },
      }),
    [requestScrollToTop],
  );

  return (
    <MainTabContext.Provider value={tabContext}>
      <NativeTabs
        backBehavior="initialRoute"
        backgroundColor={theme.colors.base100}
        iconColor={{
          default: theme.colors.primaryContent,
          selected: theme.colors.primary,
        }}
        labelStyle={{
          default: { color: theme.colors.primaryContent },
          selected: { color: theme.colors.primary },
        }}
        minimizeBehavior="onScrollDown"
        shadowColor={`${theme.colors.primary}33`}
        sidebarAdaptable={false}
        tintColor={theme.colors.primary}
      >
        <NativeTabs.Trigger
          listeners={tabPressListeners('home')}
          name="HomeTab"
        >
          <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            md="home"
            sf={{ default: 'house', selected: 'house.fill' }}
          />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          listeners={tabPressListeners('explore')}
          name="ExploreTab"
        >
          <NativeTabs.Trigger.Label>Feed</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            md="layers"
            sf={{
              default: 'square.stack.3d.up',
              selected: 'square.stack.3d.up.fill',
            }}
          />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          listeners={tabPressListeners('chat')}
          name="ChatTab"
        >
          <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
          <NativeTabs.Trigger.Icon
            md="chat"
            sf={{
              default: 'bubble.left.and.bubble.right',
              selected: 'bubble.left.and.bubble.right.fill',
            }}
          />
        </NativeTabs.Trigger>
      </NativeTabs>
    </MainTabContext.Provider>
  );
}
