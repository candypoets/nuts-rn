import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { neventEncode } from 'nostr-tools/nip19';
import { Kind1Sub } from '../src/subs/Kind1Sub';

let mockLatestFeedProps: Record<string, unknown> | null = null;
let mockLatestNoteProps: Record<string, unknown> | null = null;
type HeaderMessage = { parsed?: unknown; raw?: unknown };
type SubscribeCall = [
  string,
  Array<Record<string, unknown>>,
  (message: HeaderMessage) => void,
  Record<string, unknown>?,
];
type PaginatedConfig = {
  subId: string;
  requests: Array<Record<string, unknown>>;
  onStateChange: (state: { loading: boolean }) => void;
};
type PaginatedController = {
  close: jest.Mock;
  loadMore: jest.Mock;
  start: jest.Mock;
};
const mockSubscribeUntilEose = jest.fn<() => void, SubscribeCall>(() =>
  jest.fn(),
);
const mockRawSubscribe = jest.fn<() => void, SubscribeCall>(() => jest.fn());
const mockCreatePaginatedSubscription = jest.fn<
  PaginatedController,
  [PaginatedConfig]
>();
const mockSetRelayStatus = jest.fn();
const mockSetSubRelays = jest.fn();
const mockScrollBy = jest.fn();

jest.mock('../src/components/Feed', () => {
  const ReactModule = require('react');
  return {
    Feed: (props: Record<string, unknown>) => {
      mockLatestFeedProps = props;
      const adjustRef = props.scrollAdjustRef as
        | { current: { scrollBy: jest.Mock } | null }
        | undefined;
      if (adjustRef) adjustRef.current = { scrollBy: mockScrollBy };
      return ReactModule.createElement('FeedMock');
    },
  };
});

jest.mock('../src/components/notes/Note', () => {
  const ReactModule = require('react');
  return {
    Note: (props: Record<string, unknown>) => {
      mockLatestNoteProps = props;
      return ReactModule.createElement('NoteMock');
    },
  };
});

jest.mock('../src/components/notes/RelaysList', () => ({
  RelaysList: () => null,
}));

jest.mock('../src/stores/nostrStore', () => ({
  useNostrStore: (selector: (state: { readRelays: string[] }) => unknown) =>
    selector({ readRelays: [] }),
}));

jest.mock('../src/stores/relayStore', () => ({
  useRelayStore: (
    selector: (state: {
      setRelayStatus: typeof mockSetRelayStatus;
      setSubRelays: typeof mockSetSubRelays;
    }) => unknown,
  ) =>
    selector({
      setRelayStatus: mockSetRelayStatus,
      setSubRelays: mockSetSubRelays,
    }),
}));

jest.mock('../src/nostr/subscribeUntilEose', () => ({
  subscribeUntilEose: (...args: SubscribeCall) =>
    mockSubscribeUntilEose(...args),
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
    asKind1: (event: { kind1View?: unknown }) => event.kind1View ?? null,
    asConnectionStatus: () => null,
    asNostrEvent: (message: { raw?: unknown }) => message.raw ?? null,
    isParsedEvent: (message: { parsed?: unknown }) => message.parsed ?? null,
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
    mockLatestNoteProps = null;
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
    mockScrollBy.mockReset();
    mockRawSubscribe.mockReset();
    mockRawSubscribe.mockImplementation(() => jest.fn());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('restarts root and reply subscriptions without cache', () => {
    const rootId = 'ab'.repeat(32);
    const nevent = neventEncode({ id: rootId });
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
      ([subId]) =>
        typeof subId === 'string' && subId.startsWith(`kind1_${rootId}_`),
    );
    expect(initialHeaderCall).toBeDefined();
    expect(initialHeaderCall![1][0]).toMatchObject({ cacheFirst: true });

    act(() => {
      initialHeaderCall![2]({ parsed: root });
    });
    expect(mockCreatePaginatedSubscription).toHaveBeenCalled();

    act(() => {
      (getFeedProps().onRefresh as () => void)();
    });

    expect(getFeedProps()).toMatchObject({
      pullToRefresh: true,
      refreshing: true,
    });
    const refreshedHeaderCall = [...mockSubscribeUntilEose.mock.calls]
      .reverse()
      .find(
        ([subId]) =>
          typeof subId === 'string' && subId.startsWith(`kind1_${rootId}_`),
      );
    expect(refreshedHeaderCall![0]).toContain('_refresh_1');
    expect(refreshedHeaderCall![1][0]).toMatchObject({ noCache: true });
    expect(refreshedHeaderCall![1][0].cacheFirst).toBeUndefined();

    const refreshedReplies =
      mockCreatePaginatedSubscription.mock.calls.at(-1)![0];
    expect(refreshedReplies.subId).toContain('_refresh_1');
    expect(refreshedReplies.requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kinds: [1], noCache: true }),
        expect.objectContaining({ kinds: [1111], noCache: true }),
      ]),
    );

    act(() => {
      refreshedReplies.onStateChange({ loading: false });
    });
    expect(getFeedProps().refreshing).toBe(false);

    act(() => renderer!.unmount());
  });

  it('loads a highlight thread root through the raw event pipeline', () => {
    const rootId = '12'.repeat(32);
    const nevent = neventEncode({ id: rootId, kind: 9802 });
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
      rawHeaderCall![2]({ raw });
    });
    expect(mockCreatePaginatedSubscription).toHaveBeenCalled();

    act(() => renderer!.unmount());
  });

  it('prepends ancestor rows while keeping the focused post as a stable row', () => {
    const focusedId = '78'.repeat(32);
    const parentId = '89'.repeat(32);
    const grandparentId = '9a'.repeat(32);
    const nevent = neventEncode({ id: focusedId });
    const kind1Event = (id: string, parent?: string) => ({
      createdAt: () => 789,
      id: () => id,
      kind: () => 1,
      kind1View: {
        eventRefs: () => null,
        eventRefsLength: () => 0,
        reply: () =>
          parent
            ? {
                author: () => undefined,
                id: () => parent,
              }
            : null,
      },
      pubkey: () => '90'.repeat(32),
    });
    const focused = kind1Event(focusedId, parentId);
    const parent = kind1Event(parentId, grandparentId);
    let renderer: ReactTestRenderer.ReactTestRenderer;
    let rowRenderer: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <Kind1Sub nevent={nevent} visible onClose={() => {}} />,
      );
    });
    const headerCall = mockSubscribeUntilEose.mock.calls.find(([subId]) =>
      subId.startsWith(`kind1_${focusedId}_`),
    );
    expect(headerCall).toBeDefined();

    act(() => {
      headerCall![2]({ parsed: focused });
    });
    expect(getFeedProps().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item: focused, type: 'focused' }),
      ]),
    );

    const renderItem = getFeedProps().renderItem as (info: {
      index: number;
      item: Record<string, unknown>;
      visible: boolean;
    }) => React.ReactElement;
    let rows = getFeedProps().items as Array<Record<string, unknown>>;
    act(() => {
      rowRenderer = ReactTestRenderer.create(
        renderItem({ index: 0, item: rows[0], visible: true }),
      );
    });
    expect(rows[0]).toMatchObject({ item: focused, type: 'focused' });
    expect(mockLatestNoteProps).toMatchObject({
      inlineAncestor: false,
      main: true,
      note: focused,
      threadCard: true,
    });

    act(() => {
      jest.advanceTimersByTime(20);
    });
    rows = getFeedProps().items as Array<Record<string, unknown>>;
    expect(rows.slice(0, 2)).toEqual([
      expect.objectContaining({ id: parentId, type: 'ancestor' }),
      expect.objectContaining({ item: focused, type: 'focused' }),
    ]);

    act(() => {
      rowRenderer!.update(
        renderItem({ index: 0, item: rows[0], visible: false }),
      );
    });
    expect(mockLatestNoteProps).toMatchObject({
      inlineAncestor: false,
      leading: true,
      noteId: parentId,
      visible: true,
    });

    act(() => {
      (mockLatestNoteProps!.onResolved as (event: unknown) => void)(parent);
    });
    rows = getFeedProps().items as Array<Record<string, unknown>>;
    expect(rows.slice(0, 3)).toEqual([
      expect.objectContaining({ id: grandparentId, type: 'ancestor' }),
      expect.objectContaining({
        event: parent,
        id: parentId,
        type: 'ancestor',
      }),
      expect.objectContaining({ item: focused, type: 'focused' }),
    ]);

    act(() => {
      rowRenderer!.unmount();
      renderer!.unmount();
    });
  });

  // Platform.OS defaults to ios under this preset, so the JS anchor
  // compensation path (JS_ANCHOR_COMPENSATION in Kind1Sub) is the active one.
  it('shifts the scroll offset by ancestor layout deltas through scrollAdjustRef', () => {
    const focusedId = 'ef'.repeat(32);
    const parentId = 'ba'.repeat(32);
    const nevent = neventEncode({ id: focusedId });
    const kind1Event = (id: string, parent?: string) => ({
      createdAt: () => 789,
      id: () => id,
      kind: () => 1,
      kind1View: {
        eventRefs: () => null,
        eventRefsLength: () => 0,
        reply: () =>
          parent
            ? {
                author: () => undefined,
                id: () => parent,
              }
            : null,
      },
      pubkey: () => '90'.repeat(32),
    });
    let renderer: ReactTestRenderer.ReactTestRenderer;

    act(() => {
      renderer = ReactTestRenderer.create(
        <Kind1Sub nevent={nevent} visible onClose={() => {}} />,
      );
    });
    const headerCall = mockSubscribeUntilEose.mock.calls.find(([subId]) =>
      subId.startsWith(`kind1_${focusedId}_`),
    );
    act(() => {
      headerCall![2]({ parsed: kind1Event(focusedId, parentId) });
    });
    act(() => {
      jest.advanceTimersByTime(20);
    });

    // iOS relies on the JS compensation; native MVCP stays off.
    expect(getFeedProps()).toMatchObject({
      disableMaintainVisibleContentPosition: true,
    });
    expect(getFeedProps().scrollAdjustRef).toBeTruthy();

    const rows = getFeedProps().items as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ id: parentId, type: 'ancestor' });
    const renderItem = getFeedProps().renderItem as (info: {
      index: number;
      item: Record<string, unknown>;
      visible: boolean;
    }) => React.ReactElement;

    let rowRenderer: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      rowRenderer = ReactTestRenderer.create(
        renderItem({ index: 0, item: rows[0], visible: true }),
      );
    });

    const fireLayout = (height: number) => {
      act(() => {
        rowRenderer!.root.props.onLayout({
          nativeEvent: { layout: { height } },
        });
      });
    };

    // First layout is the prepend: the anchor moves by the full row height.
    fireLayout(490);
    expect(mockScrollBy).toHaveBeenLastCalledWith(490);
    // Resolve growth only shifts by the delta.
    fireLayout(320);
    expect(mockScrollBy).toHaveBeenLastCalledWith(-170);
    // No height change, no compensation.
    fireLayout(320);
    expect(mockScrollBy).toHaveBeenCalledTimes(2);

    act(() => {
      rowRenderer!.unmount();
      renderer!.unmount();
    });
  });
});
