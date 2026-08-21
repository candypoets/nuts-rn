import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {neventEncode} from 'nostr-tools/nip19';
import {Kind1Sub} from '../src/subs/Kind1Sub';

let mockLatestFeedProps: Record<string, unknown> | null = null;
type HeaderMessage = {parsed?: unknown; raw?: unknown};
type SubscribeCall = [
  string,
  Array<Record<string, unknown>>,
  (message: HeaderMessage) => void,
  Record<string, unknown>?,
];
type PaginatedConfig = {
  subId: string;
  requests: Array<Record<string, unknown>>;
  onStateChange: (state: {loading: boolean}) => void;
};
type PaginatedController = {
  close: jest.Mock;
  loadMore: jest.Mock;
  start: jest.Mock;
};
const mockSubscribeUntilEose = jest.fn<() => void, SubscribeCall>(
  () => jest.fn(),
);
const mockRawSubscribe = jest.fn<() => void, SubscribeCall>(() => jest.fn());
const mockCreatePaginatedSubscription = jest.fn<
  PaginatedController,
  [PaginatedConfig]
>();
const mockSetRelayStatus = jest.fn();
const mockSetSubRelays = jest.fn();

jest.mock('../src/components/Feed', () => {
  const ReactModule = require('react');
  return {
    Feed: (props: Record<string, unknown>) => {
      mockLatestFeedProps = props;
      return ReactModule.createElement('FeedMock');
    },
  };
});

jest.mock('../src/components/notes/Note', () => ({
  Note: () => null,
}));

jest.mock('../src/components/notes/RelaysList', () => ({
  RelaysList: () => null,
}));

jest.mock('../src/stores/nostrStore', () => ({
  useNostrStore: (selector: (state: {readRelays: string[]}) => unknown) =>
    selector({readRelays: []}),
}));

jest.mock('../src/stores/relayStore', () => ({
  useRelayStore: (
    selector: (state: {
      setRelayStatus: typeof mockSetRelayStatus;
      setSubRelays: typeof mockSetSubRelays;
    }) => unknown,
  ) => selector({setRelayStatus: mockSetRelayStatus, setSubRelays: mockSetSubRelays}),
}));

jest.mock('../src/nostr/subscribeUntilEose', () => ({
  subscribeUntilEose: (...args: SubscribeCall) => mockSubscribeUntilEose(...args),
}));

jest.mock('@candypoets/nipworker/hooks', () => ({
  createPaginatedSubscription: (...args: [PaginatedConfig]) =>
    mockCreatePaginatedSubscription(...args),
  useSubscription: (...args: SubscribeCall) => mockRawSubscribe(...args),
}));

jest.mock('@candypoets/nipworker/utils', () => {
  const actual = jest.requireActual('@candypoets/nipworker/utils');
  return {
    ...actual,
    asConnectionStatus: () => null,
    asNostrEvent: (message: {raw?: unknown}) => message.raw ?? null,
    isParsedEvent: (message: {parsed?: unknown}) => message.parsed ?? null,
  };
});

function getFeedProps() {
  expect(mockLatestFeedProps).not.toBeNull();
  return mockLatestFeedProps!;
}

describe('Kind1 thread pull to refresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLatestFeedProps = null;
    mockSubscribeUntilEose.mockReset();
    mockSubscribeUntilEose.mockImplementation(() => jest.fn());
    mockCreatePaginatedSubscription.mockReset();
    mockCreatePaginatedSubscription.mockImplementation(() => ({
      close: jest.fn(),
      loadMore: jest.fn(),
      start: jest.fn(),
    }));
    mockSetRelayStatus.mockReset();
    mockSetSubRelays.mockReset();
    mockRawSubscribe.mockReset();
    mockRawSubscribe.mockImplementation(() => jest.fn());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restarts root and reply subscriptions without cache', () => {
    const rootId = 'ab'.repeat(32);
    const nevent = neventEncode({id: rootId});
    const root = {
      createdAt: () => 123,
      id: () => rootId,
      kind: () => 1,
      pubkey: () => 'cd'.repeat(32),
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <Kind1Sub nevent={nevent} visible onClose={() => {}} />,
      );
    });

    const initialHeaderCall = mockSubscribeUntilEose.mock.calls.find(
      ([subId]) => typeof subId === 'string' && subId.startsWith(`kind1_${rootId}_`),
    );
    expect(initialHeaderCall).toBeDefined();
    expect(initialHeaderCall![1][0]).toMatchObject({cacheFirst: true});

    act(() => {
      initialHeaderCall![2]({parsed: root});
    });
    expect(mockCreatePaginatedSubscription).toHaveBeenCalled();

    act(() => {
      (getFeedProps().onRefresh as () => void)();
    });

    expect(getFeedProps()).toMatchObject({pullToRefresh: true, refreshing: true});
    const refreshedHeaderCall = [...mockSubscribeUntilEose.mock.calls]
      .reverse()
      .find(
        ([subId]) =>
          typeof subId === 'string' && subId.startsWith(`kind1_${rootId}_`),
      );
    expect(refreshedHeaderCall![0]).toContain('_refresh_1');
    expect(refreshedHeaderCall![1][0]).toMatchObject({noCache: true});
    expect(refreshedHeaderCall![1][0].cacheFirst).toBeUndefined();

    const refreshedReplies = mockCreatePaginatedSubscription.mock.calls.at(-1)![0];
    expect(refreshedReplies.subId).toContain('_refresh_1');
    expect(refreshedReplies.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({kinds: [1], noCache: true}),
        expect.objectContaining({kinds: [1111], noCache: true}),
      ]),
    );

    act(() => {
      refreshedReplies.onStateChange({loading: false});
    });
    expect(getFeedProps().refreshing).toBe(false);

    act(() => renderer!.unmount());
  });

  it('loads a highlight thread root through the raw event pipeline', () => {
    const rootId = '12'.repeat(32);
    const nevent = neventEncode({id: rootId, kind: 9802});
    const tags = [['e', '34'.repeat(32)]];
    const raw = {
      content: () => 'Highlighted passage',
      createdAt: () => 456,
      id: () => rootId,
      kind: () => 9802,
      pubkey: () => '56'.repeat(32),
      tags: (index: number) => ({
        items: (itemIndex: number) => tags[index]?.[itemIndex] ?? null,
        itemsLength: () => tags[index]?.length ?? 0,
      }),
      tagsLength: () => tags.length,
    };
    let renderer: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <Kind1Sub nevent={nevent} visible onClose={() => {}} />,
      );
    });

    const rawHeaderCall = mockRawSubscribe.mock.calls.find(([subId]) =>
      subId.startsWith(`kind1_${rootId}_`),
    );
    expect(rawHeaderCall).toBeDefined();
    expect(rawHeaderCall![3]).toMatchObject({
      closeOnEose: true,
    });

    act(() => {
      rawHeaderCall![2]({raw});
    });
    expect(mockCreatePaginatedSubscription).toHaveBeenCalled();

    act(() => renderer!.unmount());
  });
});
