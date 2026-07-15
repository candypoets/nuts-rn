import {usePublish as publishToNostr} from '@candypoets/nipworker/hooks';
import type {ConnectionStatus, WorkerMessage} from '@candypoets/nipworker';
import {isConnectionStatus} from '@candypoets/nipworker/utils';
import type {Proof} from '@cashu/cashu-ts';
import type {EventTemplate} from 'nostr-tools';

const DEFAULT_WALLET_BACKUP_RELAYS = ['wss://relay.nuts.cash'];

export function publishProofsBackup(mint: string, proofs: Proof[], relays: string[]) {
  if (!mint) return;

  const event: EventTemplate = {
    kind: 7375,
    content: JSON.stringify({
      mint,
      proofs,
      del: [],
    }),
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
  };
  const sendId = `proof_backup_${Date.now()}`;
  const publishRelays = relays.length ? relays : DEFAULT_WALLET_BACKUP_RELAYS;

  console.log('[minting] publishing proof backup', {
    mint,
    proofs: proofs.length,
    relays: publishRelays.length,
  });

  const sendStatus: Record<string, ConnectionStatus> = {};
  publishToNostr(
    sendId,
    event,
    (message: WorkerMessage) => {
      const status = isConnectionStatus(message);
      const relay = status?.relayUrl();
      if (!status || !relay) return;
      sendStatus[relay] = status;
      console.log('[minting] proof backup publish status', {
        relay,
        status: status.status()?.toString(),
      });
    },
    {
      defaultRelays: publishRelays,
      trackStatus: true,
    },
  );
}
