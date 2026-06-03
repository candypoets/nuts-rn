import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type {
  Kind0Parsed,
  Kind10019Parsed,
  WorkerMessage,
} from '@candypoets/nipworker';
import {
  useSubscription as subscribeToNostr,
  useSignEvent,
} from '@candypoets/nipworker/hooks';
import {
  asKind0,
  asKind10019,
  asParsedEvent,
  fbArray,
} from '@candypoets/nipworker/utils';
import {Wallet as CashuWallet, type Proof} from '@cashu/cashu-ts';
import {ChevronDown} from 'lucide-react-native';
import {decode} from 'nostr-tools/nip19';
import type {Event, EventTemplate} from 'nostr-tools';

import {Avatar} from '../components/notes/Avatar';
import {shortPubkey} from '../components/notes/time';
import {MintCardPicker} from '../components/MintCardPicker';
import {DEFAULT_FEED_RELAYS} from '../nostr/relays';
import {useNostrStore, useWalletStore} from '../stores';
import {
  completeTransaction,
  failTransaction,
  markPublished,
  publishWithRetry,
  startTransaction,
  updateTransaction,
} from '../model/cashu/txRecovery';
import {
  buildZapRequestTemplate,
  getLNURLFromProfile,
  getZapInvoice,
} from '../lib/wallet';

type SendEcashModalProps = {
  pubkey: string;
  noteId?: string;
  onClose: () => void;
};

type SendState = 'idle' | 'loading' | 'sending' | 'sent' | 'error';

function normalizeMintUrl(url: string) {
  return url.trim().replace(/\/$/, '');
}

function profileName(kind0: Kind0Parsed | null, pubkey: string) {
  return (
    kind0?.name?.()?.trim() ||
    kind0?.displayName?.()?.trim() ||
    shortPubkey(pubkey)
  );
}

function decodeNoteId(noteId?: string) {
  if (!noteId) return '';
  try {
    const decoded = decode(noteId);
    if (decoded.type === 'nevent') return decoded.data.id;
  } catch {
    return noteId;
  }
  return noteId;
}

function relayHash(relays: string[]) {
  return relays.map(relay => relay.replace(/[^a-zA-Z0-9]/g, '')).join('').slice(0, 24);
}

function sumProofs(proofs: Proof[]) {
  return proofs.reduce((sum, proof) => sum + proof.amount, 0);
}

function signEvent(template: EventTemplate) {
  return new Promise<Event>((resolve, reject) => {
    try {
      useSignEvent(template, signed => {
        resolve(typeof signed === 'string' ? JSON.parse(signed) : signed);
      });
    } catch (error) {
      reject(error);
    }
  });
}

export function SendEcashModal({pubkey, noteId, onClose}: SendEcashModalProps) {
  const readRelays = useNostrStore(state => state.readRelays);
  const writeRelays = useNostrStore(state => state.writeRelays);
  const walletReadRelays = useNostrStore(state => state.walletReadRelays);
  const trustedMints = useNostrStore(state => state.trustedMints);
  const walletMintUrls = useWalletStore(state => state.walletMintUrls);
  const storedActiveMintUrl = useWalletStore(state => state.activeMintUrl);
  const balanceByMint = useWalletStore(state => state.balanceByMint);
  const setActiveMintUrl = useWalletStore(state => state.setActiveMintUrl);
  const getUnspentProofsForMint = useWalletStore(state => state.getUnspentProofsForMint);
  const setProofsForMint = useWalletStore(state => state.setProofsForMint);
  const addProofs = useWalletStore(state => state.addProofs);
  const checkAndFilterProofs = useWalletStore(state => state.checkAndFilterProofs);
  const verifyAndCleanProofs = useWalletStore(state => state.verifyAndCleanProofs);
  const [amount, setAmount] = useState('42');
  const [memo, setMemo] = useState('');
  const [selectedMint, setSelectedMint] = useState<string | null>(
    storedActiveMintUrl || walletMintUrls[0] || null,
  );
  const [kind0, setKind0] = useState<Kind0Parsed | null>(null);
  const [recipientMint, setRecipientMint] = useState<string | null>(null);
  const [recipientMints, setRecipientMints] = useState<string[]>([]);
  const [recipientP2pk, setRecipientP2pk] = useState<string | null>(null);
  const [state, setState] = useState<SendState>('loading');
  const [message, setMessage] = useState('');
  const [fees, setFees] = useState<number | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const relays = useMemo(() => {
    const resolved = [...new Set([...walletReadRelays, ...readRelays, ...writeRelays])];
    return resolved.length ? resolved : DEFAULT_FEED_RELAYS;
  }, [readRelays, walletReadRelays, writeRelays]);

  const mints = useMemo(
    () =>
      Array.from(
        new Set([...walletMintUrls, ...trustedMints].map(normalizeMintUrl)),
      ).filter(Boolean),
    [trustedMints, walletMintUrls],
  );
  const fromMint = selectedMint ? normalizeMintUrl(selectedMint) : null;
  const balance = fromMint ? balanceByMint[fromMint] || 0 : 0;
  const numericAmount = Number(amount);
  const hexNoteId = useMemo(() => decodeNoteId(noteId), [noteId]);
  const lnurl = useMemo(() => getLNURLFromProfile(kind0), [kind0]);
  const hasNip61Wallet = !!recipientP2pk && recipientMints.length > 0;
  const canSend =
    state !== 'sending' &&
    !feeLoading &&
    !!fromMint &&
    (hasNip61Wallet || !!lnurl) &&
    Number.isInteger(numericAmount) &&
    numericAmount > 0 &&
    numericAmount + Number(fees || 0) <= balance;
  const name = profileName(kind0, pubkey);

  useEffect(() => {
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    setKind0(null);
    setRecipientMint(null);
    setRecipientMints([]);
    setRecipientP2pk(null);
    setState('loading');
    setMessage('');

    unsubscribeRef.current = subscribeToNostr(
      `send_ecash_${pubkey}_${relayHash(relays)}`,
      [
        {kinds: [0], authors: [pubkey], limit: 1, cacheFirst: true, relays},
        {kinds: [10019], authors: [pubkey], limit: 1, cacheFirst: true, relays},
      ],
      (workerMessage: WorkerMessage) => {
        const parsed = asParsedEvent(workerMessage);
        if (!parsed) return;
        if (parsed.kind() === 0) {
          const profile = asKind0(parsed);
          setKind0(profile);
        }
        if (parsed.kind() === 10019) {
          const wallet = asKind10019(parsed) as Kind10019Parsed | null;
          const walletMints =
            fbArray(wallet as any, 'trustedMints')
              ?.map((mint: {url?: () => string | null}) => mint.url?.() || '')
              .map(normalizeMintUrl)
              .filter(Boolean) || [];
          const mint = walletMints[0] || null;
          const p2pk = wallet?.p2pkPubkey?.() || null;
          setRecipientMints(walletMints);
          setRecipientMint(mint ? normalizeMintUrl(mint) : null);
          setRecipientP2pk(p2pk);
          setState('idle');
          setMessage('');
        }
      },
      {closeOnEose: false},
    );

    const fallback = setTimeout(() => {
      setState(current => (current === 'loading' ? 'idle' : current));
    }, 1800);

    return () => {
      clearTimeout(fallback);
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
    };
  }, [pubkey, relays]);

  const selectMint = useCallback(
    (mint: string) => {
      const normalized = normalizeMintUrl(mint);
      setSelectedMint(normalized);
      setActiveMintUrl(normalized);
    },
    [setActiveMintUrl],
  );

  const selectRecipientMint = useCallback((mint: string) => {
    setRecipientMint(normalizeMintUrl(mint));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const toMint = recipientMint || recipientMints[0] || null;

    setFees(null);
    if (!fromMint || !Number.isInteger(numericAmount) || numericAmount <= 0) {
      setFeeLoading(false);
      return;
    }
    if (hasNip61Wallet && (!toMint || toMint === fromMint)) {
      setFees(0);
      setFeeLoading(false);
      return;
    }
    if (!hasNip61Wallet && !lnurl) {
      setFeeLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      setFeeLoading(true);
      (async () => {
        try {
          const fromWallet = new CashuWallet(fromMint);
          await fromWallet.loadMint();
          if (hasNip61Wallet && toMint && recipientP2pk) {
            const toWallet = new CashuWallet(toMint);
            await toWallet.loadMint();
            const mintQuote = await toWallet.createMintQuote(numericAmount, recipientP2pk);
            const meltQuote = await fromWallet.createMeltQuote(mintQuote.request);
            if (!cancelled) setFees(Number(meltQuote.fee_reserve || 0));
            return;
          }
          if (lnurl) {
            const zapRequest = buildZapRequestTemplate({
              pubkey,
              amount: numericAmount,
              lnurl,
              relays: writeRelays.length ? writeRelays : relays,
              content: memo.trim(),
              noteId: hexNoteId || undefined,
              createdAt: Math.floor(Date.now() / 1000),
            });
            const signedZapRequest = await signEvent(zapRequest);
            const {pr} = await getZapInvoice(lnurl, numericAmount, signedZapRequest);
            const meltQuote = await fromWallet.createMeltQuote(pr);
            if (!cancelled) setFees(Number(meltQuote.fee_reserve || 0));
          }
        } catch (error) {
          console.warn('[send-ecash] fee quote failed', error);
          if (!cancelled) setFees(null);
        } finally {
          if (!cancelled) setFeeLoading(false);
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [
    fromMint,
    hasNip61Wallet,
    hexNoteId,
    lnurl,
    memo,
    numericAmount,
    pubkey,
    recipientMint,
    recipientMints,
    recipientP2pk,
    relays,
    writeRelays,
  ]);

  const sendEcash = useCallback(async () => {
    if (!fromMint || !canSend) return;

    setState('sending');
    setMessage('Preparing proofs...');

    let selectedProofs: Proof[] = [];
    let txId: string | null = null;
    try {
      const fromWallet = new CashuWallet(fromMint);
      await fromWallet.loadMint();

      if (hasNip61Wallet && recipientP2pk) {
        const toMint = recipientMint || recipientMints[0] || fromMint;
        if (toMint !== fromMint) {
          setMessage('Preparing cross-mint quote...');
          const toWallet = new CashuWallet(toMint);
          await toWallet.loadMint();
          const mintQuote = await toWallet.createMintQuote(numericAmount, recipientP2pk);
          const meltQuote = await fromWallet.createMeltQuote(mintQuote.request);
          const amountWithFees = numericAmount + Number(meltQuote.fee_reserve || 0);
          const selection = fromWallet.selectProofsToSend(
            getUnspentProofsForMint(fromMint),
            amountWithFees,
            true,
          );
          selectedProofs = selection.send || [];
          const keep = selection.keep || [];

          if (!selectedProofs.length || sumProofs(selectedProofs) < amountWithFees) {
            throw new Error('No proofs available for this amount and fees');
          }

          txId = await startTransaction(
            'nutszap-melt',
            {
              fromMint,
              toMint,
              pubkey,
              amount: numericAmount,
              memo,
              noteId: hexNoteId || undefined,
              p2pkPubkey: recipientP2pk,
              receiptRelays: writeRelays.length ? writeRelays : relays,
            },
            selectedProofs,
          );
          await updateTransaction(txId, {
            meltQuote: {...meltQuote, mintUrl: fromMint},
            mintQuote: {...mintQuote, mintUrl: toMint},
          });

          setMessage('Swapping mints...');
          const {quote: meltResult, change} = await fromWallet.meltProofs(
            meltQuote,
            selectedProofs,
          );
          if (meltResult.state !== 'PAID') throw new Error('Cross-mint swap failed');
          await updateTransaction(txId, {proofs: []});

          let paid = false;
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const latest = await toWallet.checkMintQuote(mintQuote.quote);
            if (latest.state === 'PAID') {
              paid = true;
              break;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 1000));
          }
          if (!paid) throw new Error('Mint timeout');

          const mintedProofs = await toWallet.mintProofs(numericAmount, mintQuote.quote);
          await setProofsForMint(fromMint, keep.concat(change || []));

          setMessage('Locking ecash to recipient...');
          const lockedProofs = await toWallet.receive(
            {mint: toMint, proofs: mintedProofs, unit: 'sat'},
            {},
            {type: 'p2pk', options: {pubkey: recipientP2pk}},
          );

          const event: EventTemplate = {
            kind: 9321,
            content: memo.trim(),
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ...lockedProofs.map((proof: Proof) => ['proof', JSON.stringify(proof)]),
              ['u', toMint],
              ['p', pubkey],
              ...(hexNoteId ? [['e', hexNoteId]] : []),
            ],
          };

          await updateTransaction(txId, {nutzapEvent: event});
          setMessage('Publishing nutzap...');
          const published = await publishWithRetry(
            event,
            writeRelays.length ? writeRelays : relays,
          );
          if (published) await markPublished(txId);
          else await completeTransaction(txId, true);
          setState('sent');
          setMessage(published ? 'Sent' : 'Sent locally. Publish is still pending.');
          return;
        }

        const selection = fromWallet.selectProofsToSend(
          getUnspentProofsForMint(fromMint),
          numericAmount,
          true,
        );
        selectedProofs = selection.send || [];
        const keep = selection.keep || [];

        if (!selectedProofs.length || sumProofs(selectedProofs) < numericAmount) {
          throw new Error('No proofs available for this amount');
        }

        txId = await startTransaction(
          'nutszap',
          {
            fromMint,
            toMint,
            pubkey,
            amount: numericAmount,
            memo,
            noteId: hexNoteId || undefined,
            p2pkPubkey: recipientP2pk,
            receiptRelays: writeRelays.length ? writeRelays : relays,
          },
          selectedProofs,
        );

        setMessage('Locking ecash to recipient...');
        const lockedProofs = await fromWallet.receive(
          {mint: fromMint, proofs: selectedProofs, unit: 'sat'},
          {},
          {type: 'p2pk', options: {pubkey: recipientP2pk}},
        );

        const event: EventTemplate = {
          kind: 9321,
          content: memo.trim(),
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ...lockedProofs.map((proof: Proof) => ['proof', JSON.stringify(proof)]),
            ['u', fromMint],
            ['p', pubkey],
            ...(hexNoteId ? [['e', hexNoteId]] : []),
          ],
        };

        setMessage('Publishing nutzap...');
        await updateTransaction(txId, {nutzapEvent: event});
        await setProofsForMint(fromMint, keep);
        const published = await publishWithRetry(
          event,
          writeRelays.length ? writeRelays : relays,
        );
        if (published) await markPublished(txId);
        else await completeTransaction(txId, true);
        setState('sent');
        setMessage(published ? 'Sent' : 'Sent locally. Publish is still pending.');
        return;
      }

      if (!lnurl) throw new Error('This user has no NutsZap wallet or Lightning Address.');

      setMessage('Requesting zap invoice...');
      const zapRequest = buildZapRequestTemplate({
        pubkey,
        amount: numericAmount,
        lnurl,
        relays: writeRelays.length ? writeRelays : relays,
        content: memo.trim(),
        noteId: hexNoteId || undefined,
        createdAt: Math.floor(Date.now() / 1000),
      });
      const signedZapRequest = await signEvent(zapRequest);
      const {pr, allowsNostr} = await getZapInvoice(lnurl, numericAmount, signedZapRequest);
      const meltQuote = await fromWallet.createMeltQuote(pr);
      const amountWithFees = numericAmount + Number(meltQuote.fee_reserve || 0);
      const selection = fromWallet.selectProofsToSend(
        getUnspentProofsForMint(fromMint),
        amountWithFees,
        true,
      );
      selectedProofs = selection.send || [];
      const keep = selection.keep || [];

      if (!selectedProofs.length || sumProofs(selectedProofs) < amountWithFees) {
        throw new Error('No proofs available for this amount and fees');
      }

      txId = await startTransaction(
        'zap',
        {
          fromMint,
          pubkey,
          amount: numericAmount,
          memo,
          noteId: hexNoteId || undefined,
          lnurl,
          receiptRelays: writeRelays.length ? writeRelays : relays,
        },
        selectedProofs,
      );
      await updateTransaction(txId, {meltQuote: {...meltQuote, mintUrl: fromMint}});

      setMessage('Paying Lightning zap...');
      const {quote, change} = await fromWallet.meltProofs(meltQuote, selectedProofs);
      if (quote.state !== 'PAID') throw new Error('Payment failed');
      await updateTransaction(txId, {proofs: []});
      await setProofsForMint(fromMint, keep.concat(change || []));
      verifyAndCleanProofs().catch(error => {
        console.warn('[send-ecash] post-send proof verification failed', error);
      });
      await completeTransaction(txId);
      setState('sent');
      setMessage(
        allowsNostr
          ? 'Zap sent'
          : 'Lightning payment sent. No zap receipt is expected.',
      );
    } catch (error) {
      console.error('[send-ecash] failed', error);
      const errorMessage = error instanceof Error ? error.message : 'Could not send ecash';
      if (txId) {
        if (errorMessage.toLowerCase().includes('spent')) {
          const validProofs = await checkAndFilterProofs(fromMint, selectedProofs);
          if (validProofs.length) await addProofs(fromMint, validProofs);
          await updateTransaction(txId, {
            status: 'failed',
            error: `Recovered ${validProofs.length}/${selectedProofs.length} unspent proofs`,
          });
        } else {
          await failTransaction(txId, errorMessage);
        }
      } else if (selectedProofs.length) {
        await addProofs(fromMint, selectedProofs);
      }
      setState('error');
      setMessage(errorMessage);
    }
  }, [
    addProofs,
    canSend,
    checkAndFilterProofs,
    fromMint,
    getUnspentProofsForMint,
    hasNip61Wallet,
    hexNoteId,
    lnurl,
    memo,
    numericAmount,
    pubkey,
    recipientMint,
    recipientMints,
    recipientP2pk,
    relays,
    setProofsForMint,
    verifyAndCleanProofs,
    writeRelays,
  ]);

  return (
    <View style={styles.modalBody}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            hitSlop={12}
            onPress={onClose}
          >
            <ChevronDown size={23} color="#17212b" strokeWidth={2.3} />
          </Pressable>
          <Pressable
            style={[styles.submitButton, (!canSend || state === 'sent') && styles.submitDisabled]}
            disabled={!canSend || state === 'sent'}
            onPress={sendEcash}
          >
            <Text style={styles.submitText}>Zap</Text>
          </Pressable>
        </View>

        <View className="mx-auto mt-2 w-full max-w-[340px]">
          <MintCardPicker
            mintUrls={mints}
            activeMintUrl={fromMint}
            balanceByMint={balanceByMint}
            amount={amount}
            fee={fees}
            onChangeAmount={setAmount}
            onSelectMint={mint => {
              if (mint) selectMint(mint);
            }}
          />
        </View>

        <Text className="mt-6 text-center text-4xl font-light text-slate-300">↓</Text>

        <View className="mt-3 items-center">
          {hasNip61Wallet ? (
            <View className="w-full max-w-[340px] items-center">
              <View className="mb-3 flex-row items-center rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
                <Avatar pubkey={pubkey} size="xl" />
                <Text className="ml-2 max-w-[180px] text-lg font-semibold text-slate-700" numberOfLines={1}>
                  {name}
                </Text>
              </View>
              <MintCardPicker
                mintUrls={recipientMints}
                activeMintUrl={recipientMint}
                balanceByMint={{}}
                stripOnly
                onSelectMint={mint => {
                  if (mint) selectRecipientMint(mint);
                }}
              />
            </View>
          ) : (
            <View className="flex-row items-center rounded-full border border-slate-200 bg-white px-4 py-2 shadow-sm">
              <Avatar pubkey={pubkey} size="xl" />
              <Text className="ml-2 max-w-[180px] text-lg font-semibold text-slate-700" numberOfLines={1}>
                {name}
              </Text>
            </View>
          )}
        </View>

        <Text className="mt-8 px-4 text-center text-sm leading-5 text-slate-500">
          {feeLoading
            ? 'Calculating fees...'
            : typeof fees === 'number'
            ? fees > 0
              ? `A fee of ${fees} sats may apply for this transaction. This covers Lightning network costs and is only reserved - you might get some or all of it refunded.`
              : 'No fees apply.'
            : hasNip61Wallet
            ? 'Select the recipient mint to calculate fees.'
            : lnurl
            ? 'This will be sent as a normal Lightning zap. A fee may apply.'
            : 'Add a Lightning Address to this profile to zap.'}
        </Text>

        <TextInput
          className="mx-4 mt-7 min-h-16 rounded-xl border border-slate-200 bg-white px-5 text-xl font-semibold text-slate-900"
          value={memo}
          onChangeText={setMemo}
          placeholder="Add a memo"
          placeholderTextColor="#94a3b8"
        />

        {message ? (
          <Text
            className={`mt-4 px-4 text-center text-sm font-semibold ${
              state === 'error'
                ? 'text-red-600'
                : state === 'sent'
                ? 'text-emerald-700'
                : 'text-slate-500'
            }`}
          >
            {message}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBody: {
    backgroundColor: '#f8fafc',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 56,
    justifyContent: 'space-between',
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#e2e8f0',
    borderRadius: 20,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  submitButton: {
    alignItems: 'center',
    backgroundColor: '#158777',
    borderRadius: 19,
    flexDirection: 'row',
    gap: 7,
    height: 38,
    justifyContent: 'center',
    minWidth: 88,
    paddingHorizontal: 14,
  },
  submitDisabled: {
    backgroundColor: '#cbd5e1',
  },
  submitText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    paddingBottom: 36,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
