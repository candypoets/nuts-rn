import type {Kind0Parsed} from '@candypoets/nipworker';
import {bytesToUtf8, utf8ToBytes} from '@noble/hashes/utils';
import {bech32} from '@scure/base';
import type {Event, EventTemplate} from 'nostr-tools';

const HEX_64 = /^[0-9a-f]{64}$/i;

export function getLNURLFromProfile(kind0: Kind0Parsed | null): string | null {
  const lud06 = kind0?.lud06?.();
  if (lud06) return lud06;
  const lud16 = kind0?.lud16?.();
  if (!lud16) return null;
  const [name, domain] = lud16.split('@');
  if (!name || !domain) return null;
  return `https://${domain}/.well-known/lnurlp/${name}`;
}

export function encodeLNURL(value: string): string {
  if (value.toLowerCase().startsWith('lnurl')) return value.toLowerCase();
  return bech32.encode(
    'lnurl',
    bech32.toWords(utf8ToBytes(value)),
    2000,
  );
}

async function decodeLNURL(value: string) {
  const decoded = bech32.decode(value as `${string}1${string}`, 2000);
  return bytesToUtf8(Uint8Array.from(bech32.fromWords(decoded.words)));
}

async function resolveLNURLEndpoint(value: string) {
  if (!value.toLowerCase().startsWith('lnurl')) return value;
  const endpoint = await decodeLNURL(value);
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    throw new Error('LNURL did not decode to an HTTP endpoint');
  }
  return endpoint;
}

export function buildZapRequestTemplate({
  pubkey,
  amount,
  lnurl,
  relays,
  content = '',
  noteId,
  createdAt,
}: {
  pubkey: string;
  amount: number;
  lnurl: string;
  relays: string[];
  content?: string;
  noteId?: string;
  createdAt: number;
}): EventTemplate {
  const amountMsats = Number(amount) * 1000;
  const encodedLnurl = encodeLNURL(lnurl);
  const cleanRelays = relays.map(relay => relay.trim()).filter(Boolean);

  if (!HEX_64.test(pubkey)) throw new Error('Zap recipient must be a hex pubkey');
  if (!Number.isFinite(amountMsats) || amountMsats <= 0 || !Number.isInteger(amountMsats)) {
    throw new Error('Zap amount must convert to a positive integer millisat value');
  }
  if (!encodedLnurl.startsWith('lnurl')) {
    throw new Error('Zap request lnurl tag must be a bech32 LNURL value');
  }
  if (!cleanRelays.length) throw new Error('Zap request needs receipt relays');
  if (noteId && !HEX_64.test(noteId)) throw new Error('Zap event id must be hex');

  return {
    kind: 9734,
    content,
    created_at: createdAt,
    tags: [
      ['p', pubkey],
      ['amount', String(amountMsats)],
      ['lnurl', encodedLnurl],
      ...(noteId ? [['e', noteId]] : []),
      ['relays', ...cleanRelays],
    ],
  };
}

export async function getZapInvoice(
  lnurl: string,
  amount: number,
  zapRequest: Event,
): Promise<{pr: string; allowsNostr: boolean}> {
  const endpoint = await resolveLNURLEndpoint(lnurl);
  const endpointUrl = new URL(endpoint);
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Cannot reach Lightning provider: ${response.status}`);
  }
  const meta = (await response.json()) as {
    callback?: string;
    allowsNostr?: boolean;
    commentAllowed?: number;
  };
  if (!meta.callback) throw new Error('No LNURL callback found');

  const callback = meta.callback.startsWith('http')
    ? meta.callback
    : `${endpointUrl.origin}${meta.callback}`;
  const callbackUrl = new URL(callback);
  callbackUrl.searchParams.set('amount', String(amount * 1000));
  callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest));

  const commentAllowed = meta.commentAllowed ?? 0;
  if (commentAllowed > 0 && zapRequest.content) {
    callbackUrl.searchParams.set('comment', zapRequest.content.slice(0, commentAllowed));
  }

  const invoiceResponse = await fetch(callbackUrl.toString(), {
    credentials: 'omit',
    headers: {Accept: 'application/json'},
  });
  if (!invoiceResponse.ok) {
    throw new Error(`Lightning invoice failed: ${invoiceResponse.status}`);
  }
  const invoice = (await invoiceResponse.json()) as {pr?: string};
  if (!invoice.pr) throw new Error('No payment request in LNURL response');
  return {pr: invoice.pr, allowsNostr: !!meta.allowsNostr};
}
