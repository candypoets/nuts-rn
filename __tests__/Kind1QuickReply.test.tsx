import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import {TextInput} from 'react-native';
import type {ParsedEvent} from '@candypoets/nipworker';
import {buildKind1QuickReplyEvent} from '../src/components/notes/buildKind1QuickReplyEvent';
import {Kind1QuickReply} from '../src/components/notes/Kind1QuickReply';

const mockPublishToNostr = jest.fn();
const mockUpdateSendStatus = jest.fn();
const mockPublishUnsubscribe = jest.fn();

jest.mock('@candypoets/nipworker/hooks', () => ({
  usePublish: (...args: unknown[]) => mockPublishToNostr(...args),
}));

jest.mock('@candypoets/nipworker/utils', () => ({
  isConnectionStatus: (message: {status?: unknown}) => message.status ?? null,
}));

jest.mock('nostr-tools', () => ({
  nip10: {
    parse: (event: {tags?: string[][]}) => {
      const eventTags = (event.tags ?? []).filter(tag => tag[0] === 'e');
      const root = eventTags.find(tag => tag[3] === 'root') ?? eventTags[0];
      const reply =
        eventTags.find(tag => tag[3] === 'reply') ?? eventTags.at(-1);
      return {
        mentions: [],
        profiles: (event.tags ?? [])
          .filter(tag => tag[0] === 'p')
          .map(tag => ({pubkey: tag[1], relays: tag[2] ? [tag[2]] : []})),
        reply: reply
          ? {id: reply[1], relays: reply[2] ? [reply[2]] : []}
          : undefined,
        root: root
          ? {id: root[1], relays: root[2] ? [root[2]] : []}
          : undefined,
      };
    },
  },
  nip19: {
    decode: jest.fn(),
  },
}));

jest.mock('react-native-keyboard-controller', () => {
  const ReactModule = require('react');
  const {View: NativeView} = require('react-native');
  return {
    KeyboardStickyView: ({children}: {children: React.ReactNode}) =>
      ReactModule.createElement(NativeView, null, children),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({bottom: 0, left: 0, right: 0, top: 0}),
}));

jest.mock('../src/stores/authStore', () => ({
  useAuthStore: (
    selector: (state: {pubkey: string; hasSigner: boolean}) => unknown,
  ) => selector({pubkey: 'viewer-pubkey', hasSigner: true}),
}));

jest.mock('../src/stores/nostrStore', () => ({
  useNostrStore: (selector: (state: {writeRelays: string[]}) => unknown) =>
    selector({writeRelays: ['wss://write.example']}),
}));

jest.mock('../src/stores/sendStatusStore', () => ({
  useSendStatusStore: (
    selector: (state: {updateSendStatus: typeof mockUpdateSendStatus}) => unknown,
  ) => selector({updateSendStatus: mockUpdateSendStatus}),
}));

jest.mock('../src/theme', () => ({
  useAppTheme: () => ({
    colors: {
      primary: '#158777',
      primaryContent: '#6b7280',
    },
  }),
}));

function parsedNote({
  author = 'author-pubkey',
  id = 'parent-id',
  tags = [],
}: {
  author?: string;
  id?: string;
  tags?: string[][];
} = {}) {
  return {
    id: () => id,
    kind: () => 1,
    pubkey: () => author,
    tagsLength: () => tags.length,
    tags: (tagIndex: number) => ({
      itemsLength: () => tags[tagIndex]?.length ?? 0,
      items: (itemIndex: number) => tags[tagIndex]?.[itemIndex] ?? '',
    }),
  } as unknown as ParsedEvent;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPublishToNostr.mockReturnValue(mockPublishUnsubscribe);
});

test('builds a root reply with the parent author and client tags', () => {
  const event = buildKind1QuickReplyEvent(
    parsedNote(),
    '  quick reply  ',
    'wss://write.example',
  );

  expect(event).toMatchObject({kind: 1, content: 'quick reply'});
  expect(event?.tags).toEqual(
    expect.arrayContaining([
      ['e', 'parent-id', '', 'root'],
      ['p', 'author-pubkey', 'wss://write.example'],
      ['client', 'nutscash'],
    ]),
  );
});

test('keeps the thread root and marks the displayed reply as the parent', () => {
  const event = buildKind1QuickReplyEvent(
    parsedNote({
      id: 'displayed-reply-id',
      tags: [
        ['e', 'thread-root-id', 'wss://root.example', 'root'],
        ['p', 'root-author'],
      ],
    }),
    'reply to this reply',
  );

  expect(event?.tags).toEqual(
    expect.arrayContaining([
      ['e', 'thread-root-id', 'wss://root.example', 'root'],
      ['e', 'displayed-reply-id', '', 'reply'],
      ['p', 'author-pubkey', ''],
    ]),
  );
});

test('publishes into the active thread and clears after the first true ack', () => {
  const note = parsedNote();
  let renderer: ReactTestRenderer.ReactTestRenderer;

  act(() => {
    renderer = ReactTestRenderer.create(
      <Kind1QuickReply note={note} relays={[]} visible />,
    );
  });

  const input = renderer!.root.findByType(TextInput);
  act(() => input.props.onChangeText('hello thread'));
  const send = renderer!.root.find(
    node => node.props.accessibilityLabel === 'Send quick reply',
  );
  act(() => send.props.onPress());

  expect(mockPublishToNostr).toHaveBeenCalledWith(
    expect.stringContaining('quick_reply_parent-id_'),
    expect.objectContaining({kind: 1, content: 'hello thread'}),
    expect.any(Function),
    {
      defaultRelays: ['wss://write.example'],
      subId: [
        'replies_parent-id_',
        'note_parent-id_',
        'f_parent-id_',
      ],
      trackStatus: true,
    },
  );
  expect(renderer!.root.findByType(TextInput).props.value).toBe('hello thread');

  const publishCallback = mockPublishToNostr.mock.calls[0][2];
  act(() => {
    publishCallback({
      status: {
        relayUrl: () => 'wss://write.example',
        status: () => 'true',
      },
    });
  });

  expect(renderer!.root.findByType(TextInput).props.value).toBe('');
  expect(mockUpdateSendStatus).toHaveBeenCalled();
  expect(mockPublishUnsubscribe).toHaveBeenCalled();

  act(() => renderer!.unmount());
});
