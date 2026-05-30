export type RootStackParamList = {
  Main: undefined;
  Profile: undefined;
  Login: undefined;
  Logout: undefined;
  FeedBuilder: undefined;
  Post: { reply?: string } | undefined;
  Send: undefined;
  SendEcash: { pubkey: string };
  Scan: undefined;
  Tapcash: undefined;
  Lightning: { invoice?: string } | undefined;
  ProfileStub: { path: 'relays' | 'wallet' | 'theme' | 'nprofile' };
  PublicProfile: { pubkey: string };
  Kind1Thread: { nevent: string };
  ChatThread: { peerPubkey: string };
  Notifications: undefined;
};
