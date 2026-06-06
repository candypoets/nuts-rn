import React, {memo, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {ConnectionStatus, ParsedEvent, WorkerMessage} from '@candypoets/nipworker';
import {Kind1018Parsed, Kind1068Parsed, PollType} from '@candypoets/nipworker';
import {
  asConnectionStatus,
  asParsedEvent,
  fbArray,
} from '@candypoets/nipworker/utils';
import {
  usePublish as publishToNostr,
  useSubscription as subscribeToNostr,
} from '@candypoets/nipworker/hooks';
import {BarChart3, Check, CheckCircle2} from 'lucide-react-native';
import {useAuthStore, useSendStatusStore} from '../../stores';
import {ContentBlocks} from './ContentBlocks';
import {formatTimestamp, stringValue} from './kindHelpers';

type Kind1068ContentProps = {
  note: ParsedEvent;
  visible: boolean;
};

type VoteState = {
  votes: Map<string, Set<string>>;
  voterTimestamps: Map<string, number>;
  processedIds: Set<string>;
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

function Kind1068ContentComponent({note, visible}: Kind1068ContentProps) {
  const poll = useMemo(() => getKind1068(note), [note]);
  const pubkey = useAuthStore(state => state.pubkey);
  const updateSendStatus = useSendStatusStore(state => state.updateSendStatus);
  const [selectedOptions, setSelectedOptions] = useState<Set<string>>(new Set());
  const [userVotedOptions, setUserVotedOptions] = useState<Set<string>>(new Set());
  const [isVoting, setIsVoting] = useState(false);
  const [version, setVersion] = useState(0);
  const voteStateRef = useRef<VoteState>({
    votes: new Map(),
    voterTimestamps: new Map(),
    processedIds: new Set(),
  });
  const noteId = note.id() || '';
  const pollRelays = useMemo(
    () => (poll ? fbArray(poll, 'relayUrls').map(url => stringValue(url)).filter(Boolean) : []),
    [poll],
  );
  const options = useMemo(() => (poll ? fbArray(poll, 'options') : []), [poll]);
  const contentBlocks = useMemo(
    () => (poll ? fbArray(poll, 'contentBlocks') : []),
    [poll],
  );
  const pollEnded = useMemo(() => {
    const endsAt = poll?.endsAt();
    if (!endsAt || endsAt === BigInt(0)) return false;
    return Date.now() > Number(endsAt) * 1000;
  }, [poll]);
  const endsAtLabel = poll?.endsAt() && poll.endsAt() !== BigInt(0)
    ? formatTimestamp(poll.endsAt())
    : '';
  const totalVotes = uniqueVoteTotal(voteStateRef.current.votes);
  const hasVoted = !!pubkey && userVotedOptions.size > 0;

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
        const existingTimestamp = voteState.voterTimestamps.get(voterPubkey) || 0;
        if (existingTimestamp && timestamp <= existingTimestamp) return;
        voteState.voterTimestamps.set(voterPubkey, timestamp);
        selected = fbArray(voteData, 'selectedOptions').map(option => stringValue(option));
      }

      const nextVotes = new Map(voteState.votes);
      nextVotes.forEach((voters, optionId) => {
        if (voters.has(voterPubkey)) {
          nextVotes.set(optionId, new Set([...voters].filter(current => current !== voterPubkey)));
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
    voteStateRef.current = {
      votes: new Map(),
      voterTimestamps: new Map(),
      processedIds: new Set(),
    };
    setSelectedOptions(new Set());
    setUserVotedOptions(new Set());
    setVersion(current => current + 1);
  }, [noteId]);

  useEffect(() => {
    if (!visible || !noteId) return;
    const unsubscribe = subscribeToNostr(
      `poll_votes_${noteId}`,
      [{kinds: [1018], tags: {'#e': [noteId]}, limit: 500, relays: pollRelays, cacheFirst: true}],
      (message: WorkerMessage) => {
        if (asConnectionStatus(message)) return;
        const parsed = asParsedEvent(message);
        if (parsed?.kind() === 1018) applyVote(parsed);
      },
      {closeOnEose: false},
    );
    return () => unsubscribe();
  }, [applyVote, noteId, pollRelays, visible]);

  const toggleOption = useCallback(
    (optionId: string) => {
      if (!poll || pollEnded || hasVoted) return;
      setSelectedOptions(current => {
        if (poll.pollType() === PollType.SingleChoice) return new Set([optionId]);
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
      {defaultRelays: pollRelays.length ? pollRelays : undefined, trackStatus: true},
    );
  }, [isVoting, note, noteId, pollRelays, pubkey, selectedOptions, updateSendStatus]);

  if (!poll) {
    return (
      <View className="mt-2 flex-row items-center gap-2 rounded-lg bg-base-200/70 p-3">
        <BarChart3 size={18} color="#158777" />
        <Text className="text-sm text-base-content">
          Poll (kind 1068) - parsed data not available
        </Text>
      </View>
    );
  }

  return (
    <View className="mt-2 overflow-hidden rounded-lg border border-base-200 bg-base-200/50">
      <View className="p-4">
        <View className="mb-3 flex-row flex-wrap items-center gap-2">
          <BarChart3 size={20} color="#158777" />
          <Text className="text-sm font-medium text-primary-content">Poll</Text>
          <Text className="rounded-full bg-base-300 px-2 py-0.5 text-xs text-base-content">
            {poll.pollType() === PollType.SingleChoice ? 'Single choice' : 'Multiple choice'}
          </Text>
          {pollEnded ? (
            <Text className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-600">
              Ended
            </Text>
          ) : endsAtLabel ? (
            <Text className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-xs text-yellow-700">
              Ends {endsAtLabel}
            </Text>
          ) : null}
        </View>
        {contentBlocks.length ? (
          <ContentBlocks
            content={contentBlocks}
            note={note}
            showMedia={false}
            showQuote={false}
            forceFullContent
          />
        ) : (
          <Text className="text-lg font-semibold text-base-content">
            {stringValue(poll.question())}
          </Text>
        )}
      </View>

      <View className="gap-2 px-4 pb-4">
        {options.map((option, index) => {
          const optionId = stringValue(option.id());
          const label = stringValue(option.label()) || optionId;
          const count = voteStateRef.current.votes.get(optionId)?.size || 0;
          const percentage = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
          const selected = selectedOptions.has(optionId);
          const voted = userVotedOptions.has(optionId);
          return (
            <Pressable
              key={`${optionId}-${index}`}
              className={['gap-1', pollEnded ? 'opacity-60' : ''].join(' ')}
              onPress={event => {
                event.stopPropagation();
                toggleOption(optionId);
              }}
            >
              <View
                className={[
                  'flex-row items-center justify-between gap-3 rounded-lg border-2 p-3',
                  selected || voted ? 'border-primary bg-primary/10' : 'border-base-300',
                ].join(' ')}
              >
                <View className="min-w-0 flex-1 flex-row items-center gap-3">
                  <View
                    className={[
                      'h-5 w-5 items-center justify-center rounded-full border-2',
                      selected || voted ? 'border-primary bg-primary' : 'border-primary-content/40',
                    ].join(' ')}
                  >
                    {selected || voted ? <Check size={13} color="#ffffff" /> : null}
                  </View>
                  <Text className="min-w-0 flex-1 font-medium text-base-content">
                    {label}
                  </Text>
                </View>
                <Text className="text-xs text-primary-content">
                  {count} ({percentage}%)
                </Text>
              </View>
              {totalVotes > 0 ? (
                <View className="h-1.5 overflow-hidden rounded-full bg-base-300">
                  <View
                    className="h-full rounded-full bg-primary"
                    style={{width: `${percentage}%`}}
                  />
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <View className="flex-row items-center justify-between border-t border-base-300 px-4 py-3">
        <Text className="text-sm text-primary-content">
          {totalVotes} total vote{totalVotes === 1 ? '' : 's'}
        </Text>
        {!pollEnded && !hasVoted && selectedOptions.size ? (
          <Pressable
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

export const Kind1068Content = memo(Kind1068ContentComponent);
