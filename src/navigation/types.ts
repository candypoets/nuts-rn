export type RootStackParamList = {
  Main: undefined;
  Profile: undefined;
  Login: undefined;
  Logout: undefined;
  CmdK: undefined;
  FeedBuilder: undefined;
  Post: { reply?: string; quote?: string } | undefined;
  Receive: undefined;
  Minting: undefined;
  Send: undefined;
  NewChat: undefined;
  SendEcash: {
    pubkey: string;
    noteId?: string;
    targetKind?: number;
    targetAddress?: string;
  };
  Share: { nevent: string; naddr?: string };
  Scan: { mode?: 'share' | 'scan' } | undefined;
  Tapcash: undefined;
  Lightning: { invoice?: string } | undefined;
  Theme: undefined;
  Keys: undefined;
  Mints: undefined;
  RelayPreferences: undefined;
  Wallet: undefined;
  ProfileStub: { path: 'relays' | 'wallet' | 'nprofile' };
  RelayInfos: {
    subId?: string;
    relays: string[];
    statuses?: Record<string, string>;
    mode?: 'relays' | 'communities';
  };
  Community: {
    description?: string;
    icon?: string;
    name?: string;
    relationship?: 'follow' | 'belong';
    relay: string;
  };
  CalendarEvent: { relay: string; address: string };
  PublicProfile: { pubkey: string };
  Kind1Thread: { nevent: string };
  Kind30023Thread: { naddr: string };
  LiveStream: { nevent: string };
  Kind1111Comments: { nevent: string };
  Tags: { tags: string[] };
  ChatThread: { peerPubkey: string };
  Notifications: undefined;
};

type NavigationArgs<RouteName extends keyof RootStackParamList> =
  undefined extends RootStackParamList[RouteName]
    ?
        | [screen: RouteName]
        | [screen: RouteName, params: RootStackParamList[RouteName]]
    : [screen: RouteName, params: RootStackParamList[RouteName]];

/**
 * Minimal structural replacement for
 * NativeStackNavigationProp<RootStackParamList> now that the
 * @react-navigation/* packages are no longer direct dependencies.
 * Covers exactly the members call sites use.
 */
export type AppNavigationProp = {
  navigate<RouteName extends keyof RootStackParamList>(
    ...args: NavigationArgs<RouteName>
  ): void;
  push<RouteName extends keyof RootStackParamList>(
    screen: RouteName,
    params: RootStackParamList[RouteName]
  ): void;
  goBack(): void;
  replace<RouteName extends keyof RootStackParamList>(
    ...args: NavigationArgs<RouteName>
  ): void;
  setOptions(options: {
    headerSearchBarOptions?: {
      onChangeText?: (event: {nativeEvent: {text: string}}) => void;
      onSearchButtonPress?: (event: {nativeEvent: {text: string}}) => void;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }): void;
  getState(): {
    routes: Array<{
      name: string;
      params?: RootStackParamList[keyof RootStackParamList];
    }>;
  };
};
