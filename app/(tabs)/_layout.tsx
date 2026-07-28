import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {type Href, usePathname} from 'expo-router';
import {
  Tabs,
  TabList,
  TabSlot,
  TabTrigger,
  type ExpoTabsScreenOptions,
} from 'expo-router/ui';
import {
  useIsFocused,
  useNavigation,
} from 'expo-router/react-navigation';
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
  routeId: RouteId;
};

const MAIN_TABS: readonly MainTabItem[] = [
  {
    name: 'HomeTab',
    href: '/HomeTab',
    routeId: 'home',
    label: 'Home',
    renderIcon: ({tint, size}) => (
      <House color={tint} size={size} strokeWidth={2} />
    ),
  },
  {
    name: 'ExploreTab',
    href: '/ExploreTab',
    routeId: 'explore',
    label: 'Feed',
    renderIcon: ({tint, size}) => (
      <Layers3 color={tint} size={size} strokeWidth={2} />
    ),
  },
  {
    name: 'ChatTab',
    href: '/ChatTab',
    routeId: 'chat',
    label: 'Chats',
    renderIcon: ({tint, size}) => (
      <MessageCircle color={tint} size={size} strokeWidth={2} />
    ),
  },
];

const DEFAULT_TAB_INDEX = 1;

export function getInitialTabIndex(pathname: string) {
  const index = MAIN_TABS.findIndex(item => item.href === pathname);
  return index >= 0 ? index : DEFAULT_TAB_INDEX;
}

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
  const {activateRoute, manager} = context;

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

type SelectTab = (index: number) => void;

type TabNavigationBridge = {
  dispatch: (action: {
    type: 'JUMP_TO';
    target: string;
    payload: {name: string};
  }) => void;
  emit: (event: {
    type: 'tabPress';
    target: string;
    canPreventDefault: true;
  }) => {defaultPrevented: boolean};
  getState: () =>
    | {
        index: number;
        key: string;
        routes: readonly {key: string; name: string}[];
      }
    | undefined;
};

const TabSelectionBridge = forwardRef<
  SelectTab,
  {requestScrollToTop: (routeId: RouteId) => void}
>(function TabSelectionBridge({requestScrollToTop}, ref) {
  const navigation = useNavigation<TabNavigationBridge>();

  const selectTab = useCallback<SelectTab>(
    index => {
      const tab = MAIN_TABS[index];
      if (!tab) return;

      const state = navigation.getState();
      if (!state) return;

      const route = state.routes.find(candidate => candidate.name === tab.name);
      if (!route) return;

      const event = navigation.emit({
        type: 'tabPress',
        target: route.key,
        canPreventDefault: true,
      });
      if (event.defaultPrevented) return;

      if (state.routes[state.index]?.key === route.key) {
        requestScrollToTop(tab.routeId);
        return;
      }

      navigation.dispatch({
        type: 'JUMP_TO',
        target: state.key,
        payload: {name: tab.name},
      });
    },
    [navigation, requestScrollToTop],
  );

  useImperativeHandle(ref, () => selectTab, [selectTab]);
  return null;
});

export default function MainTabsLayout() {
  const theme = useAppTheme();
  const pathname = usePathname();
  const selectTabRef = useRef<SelectTab | null>(null);
  const initialTabIndex = getInitialTabIndex(pathname);
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
      return {...current, [routeId]: true};
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

  const selectTab = useCallback(
    (index: number) => {
      selectTabRef.current?.(index);
    },
    [],
  );

  return (
    <MainTabContext.Provider value={tabContext}>
      <TabBarMinimizeProvider>
        <Tabs
          options={{
            backBehavior: 'initialRoute',
            screenOptions: MAIN_TAB_SCREEN_OPTIONS,
          }}>
          <TabSelectionBridge
            ref={selectTabRef}
            requestScrollToTop={requestScrollToTop}
          />
          <TabSlot />
          <TabList asChild>
            <GlassTabBar
              haptics
              initialIndex={initialTabIndex}
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
