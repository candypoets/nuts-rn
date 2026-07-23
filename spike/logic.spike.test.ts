// Spike: can the pure-logic + store + hook modules load and run under jest
// with only the nipworker mocks added?
import {
  walletSubscriptionId,
  uniqueWalletRelays,
} from '../src/hooks/useWalletSubscription';
import { useFeedBuilderStore } from '../src/stores/feedBuilderStore';
import { contentTags } from '../src/nostr/prepareEvent';
import { identityHue, initials } from '../src/lib/identity';

describe('logic layer spike', () => {
  it('walletSubscriptionId embeds pubkey and relay hash', () => {
    const a = walletSubscriptionId('pk1', ['wss://a'], 0);
    const b = walletSubscriptionId('pk1', ['wss://a', 'wss://b'], 0);
    expect(a).toContain('pk1');
    expect(a).not.toBe(b); // relay set changes the sub id (AGENTS.md bug class)
  });

  it('uniqueWalletRelays merges, dedups, and adds wallet fallback relays', () => {
    const out = uniqueWalletRelays(['wss://a'], ['wss://a', 'wss://b']);
    expect(out).toContain('wss://a');
    expect(out).toContain('wss://b');
    expect(out).toContain('wss://relay.nuts.cash'); // WALLET_FALLBACK_RELAYS
    expect(new Set(out).size).toBe(out.length);
  });

  it('feedBuilderStore is a working zustand store', () => {
    const s = useFeedBuilderStore.getState();
    expect(s).toBeTruthy();
  });

  it('contentTags parses hashtags from text', () => {
    const tags = contentTags('hello #nostr world');
    expect(JSON.stringify(tags)).toContain('nostr');
  });

  it('identity helpers are pure', () => {
    expect(identityHue('abcd')).toBeGreaterThanOrEqual(0);
    expect(initials('Alice Bob')).toBeTruthy();
  });
});
