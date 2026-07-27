import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, Text, View } from 'react-native';
import type {
  ConnectionStatus,
  ParsedEvent,
  WorkerMessage,
} from '@candypoets/nipworker';
import {
  Kind1018Parsed,
  Kind1068Parsed,
  PollType,
} from '@candypoets/nipworker';
import {
  asConnectionStatus,
  asParsedEvent,
  fbArray,
} from '@candypoets/nipworker/utils';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import { Check, CheckCircle2 } from 'lucide-react-native';
import { useAuthStore } from '../../stores/authStore';
import { useSendStatusStore } from '../../stores/sendStatusStore';
import { ContentBlocks } from './ContentBlocks';
import { formatTimestamp, stringValue } from './kindHelpers';

type Kind1068ContentProps = {
  note: ParsedEvent;
  visible: boolean;
  relays?: string[];
  depth?: number;
  showQuote?: boolean;
  showMedia?: boolean;
  forceFullContent?: boolean;
  renderQuote?: (quote: {
    id: string;
    author?: string;
    relays: string[];
    depth: number;
    key: string;
  }) => React.ReactNode;
};

type VoteState = {
  votes: Map<string, Set<string>>;
  voterTimestamps: Map<string, number>;
  processedIds: Set<string>;
};

type PollWidgetProps = {
  note: ParsedEvent;
  poll: Kind1068Parsed;
  visible: boolean;
};

function getKind1068(note: ParsedEvent) {
  try {
    return note.parsed(new Kind1068Parsed()) as Kind1068Parsed | null;
  } catch {
    return null;
  }
}

function uniqueVoteTotal(votes: Map<string, Set<string>>) {
  const voters = new Set<string>();
  votes.forEach(optionVoters => {
    optionVoters.forEach(pubkey => voters.add(pubkey));
  });
  return voters.size;
}

function PollWidget({ note, poll, visible }: PollWidgetProps) {
  const pubkey = useAuthStore(state => state.pubkey);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(
    new Set(),
  );
  const [userVotedOptions, setUserVotedOptions] = useState<Set<string>>(
    new Set(),
  );
  const [isVoting, setIsVoting] = useState(false);
  const [, setVersion] = useState(0);
  const voteStateRef = useRef<VoteState>({
    votes: new Map(),
    voterTimestamps: new Map(),
    processedIds: new Set(),
  });
  const noteId = note.id() || '';
  const pollRelays = useMemo(
    () =>
      fbArray(poll, 'relayUrls').flatMap(url => {
        const relay = stringValue(url);
        return relay ? [relay] : [];
      }),
    [poll],
  );
  const options = useMemo(() => fbArray(poll, 'options'), [poll]);
  const pollEnded = useMemo(() => {
    const endsAt = poll.endsAt();
    if (!endsAt || endsAt === BigInt(0)) return false;
    return Date.now() > Number(endsAt) * 1000;
  }, [poll]);
  const endsAtLabel =
    poll.endsAt() && poll.endsAt() !== BigInt(0)
      ? formatTimestamp(poll.endsAt())
      : '';
  const totalVotes = uniqueVoteTotal(voteStateRef.current.votes);
  const hasVoted = !!pubkey && userVotedOptions.size > 0;
  const showResults = hasVoted || pollEnded;

  const applyVote = useCallback(
    (parsedEvent: ParsedEvent, optimistic = false) => {
      const voterPubkey = parsedEvent.pubkey() || pubkey || '';
      if (!voterPubkey) return;
      const eventId = parsedEvent.id();
      const voteState = voteStateRef.current;
      if (!optimistic && eventId) {
        if (voteState.processedIds.has(eventId)) return;
        voteState.processedIds.add(eventId);
      }

      let selected: string[] = [];
      if (optimistic) {
        selected = Array.from(selectedOptions);
      } else {
        let voteData: Kind1018Parsed | null = null;
        try {
          voteData = parsedEvent.parsed(new Kind1018Parsed()) as Kind1018Parsed;
        } catch {
          return;
        }
        if (!voteData || voteData.pollEventId() !== noteId) return;
        const timestamp = parsedEvent.createdAt() || 0;
        const existingTimestamp =
          voteState.voterTimestamps.get(voterPubkey) || 0;
        if (existingTimestamp && timestamp <= existingTimestamp) return;
        voteState.voterTimestamps.set(voterPubkey, timestamp);
        selected = fbArray(voteData, 'selectedOptions').map(option =>
          stringValue(option),
        );
      }

      const nextVotes = new Map(voteState.votes);
      nextVotes.forEach((voters, optionId) => {
        if (voters.has(voterPubkey)) {
          nextVotes.set(
            optionId,
            new Set([...voters].filter(current => current !== voterPubkey)),
          );
        }
      });
      selected.forEach(optionId => {
        const voters = nextVotes.get(optionId) ?? new Set<string>();
        nextVotes.set(optionId, new Set([...voters, voterPubkey]));
      });
      voteState.votes = nextVotes;
      if (voterPubkey === pubkey) {
        setUserVotedOptions(new Set(selected));
        setSelectedOptions(new Set(selected));
        setIsVoting(false);
      }
      setVersion(current => current + 1);
    },
    [noteId, pubkey, selectedOptions],
  );

  useEffect(() => {
    if (!visible || !noteId) return;
    const unsubscribe = subscribeToNostr(
      `poll_votes_${noteId}`,
      [
        {
          kinds: [1018],
          tags: { '#e': [noteId] },
          limit: 500,
          relays: pollRelays,
          cacheFirst: true,
        },
      ],
      (message: WorkerMessage) => {
        if (asConnectionStatus(message)) return;
        const parsed = asParsedEvent(message);
        if (parsed?.kind() === 1018) applyVote(parsed);
      },
      { closeOnEose: false },
    );
    return () => unsubscribe();
  }, [applyVote, noteId, pollRelays, visible]);

  const toggleOption = useCallback(
    (optionId: string) => {
      if (pollEnded || hasVoted) return;
      setSelectedOptions(current => {
        if (poll.pollType() === PollType.SingleChoice)
          return new Set([optionId]);
        const next = new Set(current);
        if (next.has(optionId)) next.delete(optionId);
        else next.add(optionId);
        return next;
      });
    },
    [hasVoted, poll, pollEnded],
  );

  const castVote = useCallback(() => {
    if (!pubkey || !noteId || !selectedOptions.size || isVoting) return;
    setIsVoting(true);
    setUserVotedOptions(new Set(selectedOptions));
    setVersion(current => current + 1);

    const event = {
      kind: 1018,
      content: '',
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['e', noteId],
        ['p', note.pubkey() || ''],
        ...Array.from(selectedOptions).map(optionId => ['response', optionId]),
      ],
    };
    const sendStatus: Record<string, ConnectionStatus> = {};
    const sendId = `vote_${noteId}`;
    publishToNostr(
      sendId,
      event,
      (message: WorkerMessage) => {
        const status = asConnectionStatus(message);
        const relayUrl = status?.relayUrl();
        if (!status || !relayUrl) return;
        sendStatus[relayUrl] = status;
        updateSendStatus(sendId, sendStatus);
      },
      {
        defaultRelays: pollRelays.length ? pollRelays : undefined,
        trackStatus: true,
      },
    );
  }, [
    isVoting,
    note,
    noteId,
    pollRelays,
    pubkey,
    selectedOptions,
    updateSendStatus,
  ]);

  return (
    <View className="gap-2">
      <View className="gap-2">
        {options.map(option => {
          const optionId = stringValue(option.id());
          const label = stringValue(option.label()) || optionId;
          const count = voteStateRef.current.votes.get(optionId)?.size || 0;
          const percentage =
            totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = selectedOptions.has(optionId);
          const voted = userVotedOptions.has(optionId);
          const isSingleChoice = poll.pollType() === PollType.SingleChoice;
          return (
            <Pressable
              key={optionId}
              accessibilityRole={isSingleChoice ? 'radio' : 'checkbox'}
              accessibilityState={{
                checked: selected || voted,
                disabled: pollEnded || hasVoted,
              }}
              className={[
                'relative min-h-12 justify-center overflow-hidden px-3 py-3',
                !showResults && isSingleChoice
                  ? 'rounded-full border-2 border-primary'
                  : 'rounded-xl border border-base-300',
                !showResults && selected ? 'bg-primary/10' : '',
              ].join(' ')}
              onPress={event => {
                event.stopPropagation();
                toggleOption(optionId);
              }}
            >
              {showResults && percentage > 0 ? (
                <View
                  className="absolute bottom-0 left-0 top-0 bg-primary/20"
                  pointerEvents="none"
                  style={{ width: `${percentage}%` }}
                />
              ) : null}
              {!showResults && isSingleChoice ? (
                <Text className="text-center text-base font-semibold text-primary">
                  {label}
                </Text>
              ) : (
                <View className="flex-row items-center justify-between gap-3">
                  <View className="min-w-0 flex-1 flex-row items-center gap-2">
                    {showResults && voted ? (
                      <Check size={15} color="#158777" />
                    ) : null}
                    {!showResults ? (
                      <View
                        className={[
                          'h-5 w-5 items-center justify-center rounded-md border-2',
                          selected || voted
                            ? 'border-primary bg-primary'
                            : 'border-primary-content/40',
                        ].join(' ')}
                      >
                        {selected || voted ? (
                          <Check size={13} color="#ffffff" />
                        ) : null}
                      </View>
                    ) : null}
                    <Text className="min-w-0 flex-1 font-medium text-base-content">
                      {label}
                    </Text>
                  </View>
                  {showResults ? (
                    <Text className="text-sm font-semibold text-base-content">
                      {percentage}%
                    </Text>
                  ) : null}
                </View>
              )}
            </Pressable>
          );
        })}
      </View>

      <View className="min-h-9 flex-row items-center justify-between gap-3">
        <Text className="text-sm text-primary-content">
          {!showResults && poll.pollType() === PollType.MultipleChoice
            ? 'Select one or more'
            : `${totalVotes} vote${totalVotes === 1 ? '' : 's'}`}
          {pollEnded
            ? ' · Final results'
            : endsAtLabel
            ? ` · Ends ${endsAtLabel}`
            : ''}
        </Text>
        {!pollEnded && !hasVoted && selectedOptions.size ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Submit poll vote"
            className="rounded-full bg-primary px-4 py-2"
            onPress={event => {
              event.stopPropagation();
              castVote();
            }}
          >
            <Text className="text-sm font-semibold text-white">
              {isVoting ? 'Voting...' : 'Vote'}
            </Text>
          </Pressable>
        ) : hasVoted ? (
          <View className="flex-row items-center gap-1">
            <CheckCircle2 size={16} color="#158777" />
            <Text className="text-sm text-primary">Voted</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Kind1068ContentComponent({
  note,
  visible,
  relays,
  depth = 0,
  showQuote = true,
  showMedia = true,
  forceFullContent = false,
  renderQuote,
}: Kind1068ContentProps) {
  const poll = useMemo(() => getKind1068(note), [note]);
  const contentBlocks = useMemo(
    () => (poll ? fbArray(poll, 'contentBlocks') : []),
    [poll],
  );

  if (!poll) {
    return (
      <Text className="text-sm text-primary-content">
        Poll content is not available.
      </Text>
    );
  }

  return (
    <View className="gap-3">
      {contentBlocks.length ? (
        <ContentBlocks
          content={contentBlocks}
          note={note}
          relays={relays}
          depth={depth}
          showQuote={showQuote}
          showMedia={showMedia}
          visible={visible}
          forceFullContent={forceFullContent}
          renderQuote={renderQuote}
        />
      ) : (
        <Text className="text-[15px] font-normal text-base-content">
          {stringValue(poll.question())}
        </Text>
      )}
      <PollWidget
        key={note.id() || 'poll'}
        note={note}
        poll={poll}
        visible={visible}
      />
    </View>
  );
}

export const Kind1068Content = memo(Kind1068ContentComponent);
