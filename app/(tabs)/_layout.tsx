import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {type Href, useRouter} from 'expo-router';
import {
  Tabs,
  TabList,
  TabSlot,
  TabTrigger,
  type ExpoTabsScreenOptions,
} from 'expo-router/ui';
import {useIsFocused} from 'expo-router/react-navigation';
import {House, Layers3, MessageCircle} from 'lucide-react-native';
import type {NostrManagerLike} from '@candypoets/nipworker';
import {
  GlassTabBar,
  GlassTabButton,
  TabBarMinimizeProvider,
  type GlassTabBarTheme,
  type GlassTabItem,
} from 'expo-glass-tabs';

import {getSharedNostrManager} from '../../src/nostr/manager';
import {getAppThemeVars, useAppTheme} from '../../src/theme';

export const unstable_settings = {
  initialRouteName: 'ExploreTab',
};

export type RouteId = 'home' | 'explore' | 'chat';

type MainTabItem = GlassTabItem & {
  href: Href;
};

const MAIN_TABS: readonly MainTabItem[] = [
  {
    name: 'HomeTab',
    href: '/HomeTab',
    label: 'Home',
    renderIcon: ({tint, size}) => (
      <House color={tint} size={size} strokeWidth={2} />
    ),
  },
  {
    name: 'ExploreTab',
    href: '/ExploreTab',
    label: 'Feed',
    renderIcon: ({tint, size}) => (
      <Layers3 color={tint} size={size} strokeWidth={2} />
    ),
  },
  {
    name: 'ChatTab',
    href: '/ChatTab',
    label: 'Chats',
    renderIcon: ({tint, size}) => (
      <MessageCircle color={tint} size={size} strokeWidth={2} />
    ),
  },
];

// Expo Router 57 types `screenOptions` as the fully resolved descriptor
// shape (including internal title/action fields), although React Navigation
// accepts the partial defaults at runtime.
const MAIN_TAB_SCREEN_OPTIONS = {
  freezeOnBlur: false,
  lazy: false,
} as unknown as ExpoTabsScreenOptions;

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

export default function MainTabsLayout() {
  const theme = useAppTheme();
  const router = useRouter();
  const themeVars = useMemo(() => getAppThemeVars(theme), [theme]);
  const manager = useMemo(() => getSharedNostrManager(), []);
  const nostrEnabled = Boolean(manager);
  const tabBarTheme = useMemo<Partial<GlassTabBarTheme>>(
    () => ({
      highlight: `${theme.colors.primary}66`,
    }),
    [theme.colors.primary],
  );

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

  const selectTab = useCallback(
    (index: number) => {
      const tab = MAIN_TABS[index];
      if (tab) {
        router.navigate(tab.href);
      }
    },
    [router],
  );

  return (
    <MainTabContext.Provider value={tabContext}>
      <TabBarMinimizeProvider>
        <Tabs
          options={{
            backBehavior: 'initialRoute',
            screenOptions: MAIN_TAB_SCREEN_OPTIONS,
          }}>
          <TabSlot />
          <TabList asChild>
            <GlassTabBar
              haptics
              onIndexSelected={selectTab}
              theme={tabBarTheme}>
              {MAIN_TABS.map((item, index) => (
                <TabTrigger
                  asChild
                  href={item.href}
                  key={item.name}
                  name={item.name}>
                  <GlassTabButton index={index} item={item} />
                </TabTrigger>
              ))}
            </GlassTabBar>
          </TabList>
        </Tabs>
      </TabBarMinimizeProvider>
    </MainTabContext.Provider>
  );
}
