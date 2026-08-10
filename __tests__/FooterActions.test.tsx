import React from 'react';
import ReactTestRenderer, {act} from 'react-test-renderer';
import type {ParsedEvent} from '@candypoets/nipworker';
import {useNoteFooterActions} from '../src/components/notes/footerActions';

const mockPublishToNostr = jest.fn();
const mockNavigate = jest.fn();
const mockUpdateSendStatus = jest.fn();

jest.mock('@candypoets/nipworker/hooks', () => ({
  usePublish: (...args: unknown[]) => mockPublishToNostr(...args),
}));

jest.mock('nostr-tools', () => ({
  kinds: {Reaction: 7},
}));

jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

jest.mock('../src/stores', () => ({
  useAuthStore: (selector: (state: {pubkey: string}) => unknown) =>
    selector({pubkey: 'viewer-pubkey'}),
  useSendStatusStore: (
    selector: (state: {updateSendStatus: typeof mockUpdateSendStatus}) => unknown,
  ) => selector({updateSendStatus: mockUpdateSendStatus}),
}));

let footerActions: ReturnType<typeof useNoteFooterActions>;

function FooterActionsHarness({note}: {note: ParsedEvent}) {
  footerActions = useNoteFooterActions(note, ['wss://relay.example']);
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('routes an optimistic reaction to every subscription for the note', () => {
  const note = {
    id: () => 'note-id',
    pubkey: () => 'author-pubkey',
    kind: () => 1,
  } as unknown as ParsedEvent;

  act(() => {
    ReactTestRenderer.create(<FooterActionsHarness note={note} />);
  });
  act(() => footerActions.onLike());

  expect(mockPublishToNostr).toHaveBeenCalledWith(
    'reaction_note-id',
    expect.objectContaining({kind: 7}),
    expect.any(Function),
    {
      defaultRelays: ['wss://relay.example'],
      subId: 'note-id',
      trackStatus: true,
    },
  );
});
