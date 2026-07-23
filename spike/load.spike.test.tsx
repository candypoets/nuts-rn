// Spike: load the heavy component modules (subs/feeds/modals) under jest.
// Success = module loads; failure output names the missing native mock.
const modules = [
  '../src/feeds/ChatFeed',
  '../src/feeds/HomeFeed',
  '../src/feeds/ExploreFeed',
  '../src/subs/Kind0Sub',
  '../src/subs/Kind1Sub',
  '../src/subs/CommunitySub',
  '../src/subs/Kind4Sub',
  '../src/subs/LiveStreamSub',
  '../src/subs/NotificationsSub',
  '../src/subs/TagsSub',
  '../src/subs/Kind30023Sub',
  '../src/components/Feed',
  '../src/components/notes/Note',
  '../src/components/notes/ContentBlocks',
  '../src/components/notes/footerActions',
  '../src/modals/FeedBuilderModal',
  '../src/modals/ProfileModal',
  '../src/modals/SendEcashModal',
  '../src/modals/post/PostModal',
  '../src/modals/post/shared',
  '../src/stores/walletStore',
  '../src/stores/nostrStore',
  '../src/hooks/useRootNostrSubscriptions',
  '../src/hooks/useKind0ProfileData',
  '../src/model/cashu/txRecovery',
  '../src/nostr/upload',
  '../src/nostr/nip11',
  '../src/lib/wallet',
  '../src/lib/linkPreview',
  '../src/notifications/processNotifications',
  '../src/navigation/pushDistinct',
];

describe('module load spike', () => {
  for (const m of modules) {
    it(`loads ${m}`, () => {
      const mod = require(m);
      expect(mod).toBeTruthy();
    });
  }
});
