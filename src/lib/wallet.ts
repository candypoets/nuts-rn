import type {Kind0Parsed} from '@candypoets/nipworker';
import {bytesToUtf8, utf8ToBytes} from '@noble/hashes/utils';
import {bech32} from '@scure/base';
import type {Event, EventTemplate} from 'nostr-tools';
import {getEventHash, validateEvent, verifyEvent} from 'nostr-tools/pure';

const HEX_64 = /^[0-9a-f]{64}$/i;

export function inspectZapRequest(zapRequest: Event) {
  const computedId = getEventHash(zapRequest);
  const structurallyValid = validateEvent(zapRequest);
  const signatureValid = structurallyValid && verifyEvent(zapRequest);
  const tags = zapRequest.tags.filter(
    tag => Array.isArray(tag) && typeof tag[0] === 'string',
  );
  const tagsByName = Object.fromEntries(
    ['p', 'e', 'a', 'k', 'amount', 'lnurl', 'relays'].map(name => [
      name,
      tags.filter(tag => tag[0] === name),
    ]),
  );

  return {
    event: zapRequest,
    checks: {
      structurallyValid,
      signatureValid,
      idMatches: zapRequest.id === computedId,
      computedId,
      kindIs9734: zapRequest.kind === 9734,
      pubkeyIsHex: HEX_64.test(zapRequest.pubkey),
      idIsHex: HEX_64.test(zapRequest.id),
      signatureIsHex: /^[0-9a-f]{128}$/i.test(zapRequest.sig),
      exactlyOneRecipient: tagsByName.p.length === 1,
      atMostOneEvent: tagsByName.e.length <= 1,
      hasRelays: (tagsByName.relays[0]?.length ?? 0) > 1,
      amountMatchesIntegerMsats:
        tagsByName.amount.length === 1 &&
        /^\d+$/.test(tagsByName.amount[0]?.[1] ?? ''),
      lnurlIsBech32:
        tagsByName.lnurl.length === 1 &&
        (tagsByName.lnurl[0]?.[1] ?? '').toLowerCase().startsWith('lnurl1'),
    },
    tagsByName,
  };
}

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
  targetKind,
  targetAddress,
  createdAt,
}: {
  pubkey: string;
  amount: number;
  lnurl: string;
  relays: string[];
  content?: string;
  noteId?: string;
  targetKind?: number;
  targetAddress?: string;
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
  if (targetKind !== undefined && (!Number.isInteger(targetKind) || targetKind < 0)) {
    throw new Error('Zap target kind must be a non-negative integer');
  }
  if (targetAddress && !/^\d+:[0-9a-f]{64}:.*$/i.test(targetAddress)) {
    throw new Error('Zap target address must be a valid event coordinate');
  }

  return {
    kind: 9734,
    content,
    created_at: createdAt,
    tags: [
      ['p', pubkey],
      ['amount', String(amountMsats)],
      ['lnurl', encodedLnurl],
      ...(noteId ? [['e', noteId]] : []),
      ...(targetAddress ? [['a', targetAddress]] : []),
      ...(targetKind !== undefined ? [['k', String(targetKind)]] : []),
      ['relays', ...cleanRelays],
    ],
  };
}

export async function getZapInvoice(
  lnurl: string,
  amount: number,
  zapRequest: Event,
): Promise<{pr: string; allowsNostr: boolean}> {
  const encodedLnurl = encodeLNURL(lnurl);
  const endpoint = await resolveLNURLEndpoint(lnurl);
  const endpointUrl = new URL(endpoint);
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Cannot reach Lightning provider: ${response.status}`);
  }
  const meta = (await response.json()) as {
    callback?: string;
    allowsNostr?: boolean;
    nostrPubkey?: string;
    commentAllowed?: number;
  };
  if (!meta.callback) throw new Error('No LNURL callback found');

  console.log('[send-ecash] LNURL zap metadata', {
    endpoint,
    callbackOrigin: new URL(meta.callback, endpointUrl.origin).origin,
    allowsNostr: meta.allowsNostr === true,
    nostrPubkey: meta.nostrPubkey,
    nostrPubkeyValid: !!meta.nostrPubkey && HEX_64.test(meta.nostrPubkey),
    commentAllowed: meta.commentAllowed ?? 0,
  });

  const callback = meta.callback.startsWith('http')
    ? meta.callback
    : `${endpointUrl.origin}${meta.callback}`;
  const callbackUrl = new URL(callback);
  callbackUrl.searchParams.set('amount', String(amount * 1000));
  callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest));
  callbackUrl.searchParams.set('lnurl', encodedLnurl);

  const commentAllowed = meta.commentAllowed ?? 0;
  if (commentAllowed > 0 && zapRequest.content) {
    callbackUrl.searchParams.set('comment', zapRequest.content.slice(0, commentAllowed));
  }

  console.log('[send-ecash] LNURL zap callback request', {
    callbackOrigin: callbackUrl.origin,
    callbackPath: callbackUrl.pathname,
    amount: callbackUrl.searchParams.get('amount'),
    lnurl: callbackUrl.searchParams.get('lnurl'),
    nostrBytes: callbackUrl.searchParams.get('nostr')?.length ?? 0,
    nostr: callbackUrl.searchParams.get('nostr'),
    hasComment: callbackUrl.searchParams.has('comment'),
  });

  const invoiceResponse = await fetch(callbackUrl.toString(), {
    credentials: 'omit',
    headers: {Accept: 'application/json'},
  });
  if (!invoiceResponse.ok) {
    const responseBody = await invoiceResponse.text().catch(() => '');
    console.warn('[send-ecash] LNURL zap callback rejected request', {
      status: invoiceResponse.status,
      body: responseBody.slice(0, 1000),
    });
    throw new Error(`Lightning invoice failed: ${invoiceResponse.status}`);
  }
  const invoice = (await invoiceResponse.json()) as {pr?: string};
  if (!invoice.pr) throw new Error('No payment request in LNURL response');
  return {pr: invoice.pr, allowsNostr: !!meta.allowsNostr};
}

export async function getLightningInvoice(
  lnurl: string,
  amount: number,
): Promise<{pr: string}> {
  const endpoint = await resolveLNURLEndpoint(lnurl);
  const endpointUrl = new URL(endpoint);
  const response = await fetch(endpoint, {
    credentials: 'omit',
    headers: {Accept: 'application/json'},
  });
  if (!response.ok) {
    throw new Error(`Cannot reach Lightning provider: ${response.status}`);
  }
  const meta = (await response.json()) as {callback?: string};
  if (!meta.callback) throw new Error('No LNURL callback found');

  const callback = meta.callback.startsWith('http')
    ? meta.callback
    : `${endpointUrl.origin}${meta.callback}`;
  const callbackUrl = new URL(callback);
  callbackUrl.searchParams.set('amount', String(amount * 1000));

  const invoiceResponse = await fetch(callbackUrl.toString(), {
    credentials: 'omit',
    headers: {Accept: 'application/json'},
  });
  if (!invoiceResponse.ok) {
    throw new Error(`Lightning invoice failed: ${invoiceResponse.status}`);
  }
  const invoice = (await invoiceResponse.json()) as {pr?: string};
  if (!invoice.pr) throw new Error('No payment request in LNURL response');
  return {pr: invoice.pr};
}
