// QA thread relay: a throwaway in-memory NIP-01 relay for verifying that the
// reply-thread screen keeps the FOCUSED note pinned in the viewport while
// ancestor rows stream in above it (maintainVisibleContentPosition anchoring).
//
// What it serves:
//   - A thread chain R <- A <- B <- F (kind 1, explicit NIP-10 root/reply
//     markers). F is the focused note ("QA FOCUSED <runid>", short). R/A/B
//     have ~20-line content so each skeleton -> resolved transition grows the
//     row by several hundred px.
//   - Two immediate replies to F.
//   - F and the replies are served instantly. Ancestors are withheld from tag
//     queries (the app's reply-tree prefetch must not cache them early) and are
//     answered after ANCESTOR_DELAY_MS on their by-id REQs (first serve only;
//     re-requests are instant), so B resolves ~5s after the thread opens,
//     A ~5s later, R ~5s after that.
//
//   It also publishes the QA user's kind 10002 (read+write = this relay) to
//   the app's BOOTSTRAP_RELAYS so a fresh nsec login collapses the account
//   relay set to just this relay. Prints QA_THREAD_NSEC / QA_THREAD_NEVENT
//   (the nevent carries this relay as a hint) for maestro -e.
//
// Run:  node .qa/qa-thread-relay.mjs [--port 7877] [--delay-ms 5000]
// Emulator reaches the host relay as ws://10.0.2.2:<port> (no adb reverse
// needed). Requires internet for the one-shot kind-10002 publish.
import { createServer } from 'http';
import WebSocket, { WebSocketServer } from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
	nip19
} from 'nostr-tools';

useWebSocketImplementation(WebSocket);

// Mirrors src/stores/nostrStore.ts BOOTSTRAP_RELAYS (where the app fetches
// the account's kind 10002 after login).
const BOOTSTRAP_RELAYS = [
	'wss://relay.damus.io',
	'wss://nos.lol',
	'wss://purplepag.es',
	'wss://user.kindpag.es',
	'wss://relay.nuts.cash'
];

function arg(name, fallback) {
	const index = process.argv.indexOf('--' + name);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

const PORT = Number(arg('port', 7877));
const ANCESTOR_DELAY_MS = Number(arg('delay-ms', 5000));
// Replies to F are delayed to emulate real relay latency. Serving them
// instantly also used to trip an RN VirtualView assertion ("remove
// non-existent VirtualView") when the thread's status row vanished in the
// same mount batch that created it; Kind1Sub now keeps that row mounted, so
// the delay is only about realism.
const REPLY_DELAY_MS = Number(arg('reply-delay-ms', 2500));
const RUNID = arg('runid', Date.now().toString(36));
const RELAY_URL = `ws://10.0.2.2:${PORT}`;

const log = (...args) => console.log('[qa-thread-relay]', ...args);

// --- Keys + thread events ----------------------------------------------------

const userSec = generateSecretKey();
const userPub = getPublicKey(userSec);
const authorSec = generateSecretKey();

const nowSeconds = () => Math.floor(Date.now() / 1000);

function longContent(label) {
	const lines = [];
	for (let index = 1; index <= 20; index += 1) {
		lines.push(`${label} ${RUNID} line ${index} of twenty`);
	}
	return lines.join('\n');
}

// Chain: R (root) <- A <- B <- F (focused). Explicit NIP-10 markers; the
// relay hint in position 2 makes nipworker's auto-generated parent requests
// come straight here too.
const rootEvent = finalizeEvent(
	{
		kind: 1,
		created_at: nowSeconds() - 400,
		tags: [],
		content: longContent('QA ROOT')
	},
	authorSec
);
const ancestorA = finalizeEvent(
	{
		kind: 1,
		created_at: nowSeconds() - 300,
		tags: [['e', rootEvent.id, RELAY_URL, 'reply']],
		content: longContent('QA ANCESTOR A')
	},
	authorSec
);
const ancestorB = finalizeEvent(
	{
		kind: 1,
		created_at: nowSeconds() - 200,
		tags: [
			['e', rootEvent.id, RELAY_URL, 'root'],
			['e', ancestorA.id, RELAY_URL, 'reply']
		],
		content: longContent('QA ANCESTOR B')
	},
	authorSec
);
const focusedEvent = finalizeEvent(
	{
		kind: 1,
		created_at: nowSeconds() - 100,
		tags: [
			['e', rootEvent.id, RELAY_URL, 'root'],
			['e', ancestorB.id, RELAY_URL, 'reply']
		],
		content: `QA FOCUSED ${RUNID}`
	},
	authorSec
);
const reply1 = finalizeEvent(
	{
		kind: 1,
		created_at: nowSeconds() - 50,
		tags: [
			['e', rootEvent.id, RELAY_URL, 'root'],
			['e', focusedEvent.id, RELAY_URL, 'reply']
		],
		content: `QA reply one ${RUNID}`
	},
	authorSec
);
const reply2 = finalizeEvent(
	{
		kind: 1,
		created_at: nowSeconds() - 40,
		tags: [
			['e', rootEvent.id, RELAY_URL, 'root'],
			['e', focusedEvent.id, RELAY_URL, 'reply']
		],
		content: `QA reply two ${RUNID}`
	},
	authorSec
);

const events = [rootEvent, ancestorA, ancestorB, focusedEvent, reply1, reply2];
const delayedIds = new Set([rootEvent.id, ancestorA.id, ancestorB.id]);
const servedDelayedIds = new Set();

// --- Relay ------------------------------------------------------------------

function matchFilter(event, filter) {
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
	if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
	if (filter.ids && !filter.ids.some((id) => event.id.startsWith(id))) return false;
	if (filter.since && event.created_at < filter.since) return false;
	if (filter.until && event.created_at > filter.until) return false;
	// NIP-01 tag filters (#e, #E, #p, ...): event must carry a matching tag.
	for (const key of Object.keys(filter)) {
		if (!key.startsWith('#')) continue;
		const tagName = key.slice(1);
		const wanted = filter[key];
		if (!Array.isArray(wanted)) continue;
		const hit = event.tags.some(
			(tag) =>
				tag[0] === tagName &&
				wanted.some((value) => String(tag[1] || '').startsWith(value))
		);
		if (!hit) return false;
	}
	return true;
}

function send(ws, message) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

// Does this REQ ask for a not-yet-served ancestor by id?
function delayedAncestorHit(filters) {
	for (const filter of filters) {
		if (!filter.ids) continue;
		for (const id of filter.ids) {
			for (const delayedId of delayedIds) {
				if (delayedId.startsWith(id) && !servedDelayedIds.has(delayedId)) {
					return delayedId;
				}
			}
		}
	}
	return null;
}

// Does this REQ ask for the first page of replies to the focused note?
let repliesServed = false;
function repliesHit(filters) {
	if (repliesServed) return false;
	return filters.some((filter) => {
		const tagValues = filter['#e'] || filter['#E'];
		return (
			Array.isArray(tagValues) &&
			tagValues.some((id) => focusedEvent.id.startsWith(id))
		);
	});
}

function serveMatches(ws, subId, filters) {
	const seen = new Set();
	for (const filter of filters) {
		const matching = events
			.filter((event) => matchFilter(event, filter))
			.filter((event) => {
				// Ancestors may only leave the relay through their (delayed) by-id
				// requests; tag/author queries must not leak them early, or the
				// app's reply-tree prefetch caches them and the thread resolves
				// instantly instead of trickling in.
				if (!delayedIds.has(event.id)) return true;
				if (servedDelayedIds.has(event.id)) return true;
				return Boolean(filter.ids);
			})
			.sort((a, b) => b.created_at - a.created_at)
			.slice(0, filter.limit ?? 5000);
		for (const event of matching) {
			if (seen.has(event.id)) continue;
			seen.add(event.id);
			send(ws, ['EVENT', subId, event]);
		}
	}
	send(ws, ['EOSE', subId]);
}

const server = createServer((req, res) => {
	if ((req.headers.accept || '').includes('application/nostr+json')) {
		// Deliberately no `name`: relay UIs then fall back to the URL label
		// "10.0.2.2:<port>", which the maestro flow asserts on.
		res.writeHead(200, { 'content-type': 'application/nostr+json' });
		res.end(
			JSON.stringify({
				description: 'QA thread anchor test relay',
				pubkey: userPub,
				software: 'qa-thread-relay',
				supported_nips: [1, 11]
			})
		);
		return;
	}
	res.writeHead(200, { 'content-type': 'text/plain' });
	res.end('qa-thread-relay\n');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
	ws.qaSubs = new Map();
	log('connection open');
	ws.on('message', (raw) => {
		let message;
		try {
			message = JSON.parse(raw.toString());
		} catch {
			return;
		}
		if (!Array.isArray(message)) return;
		const [type, ...rest] = message;
		if (type === 'REQ') {
			const [subId, ...filters] = rest;
			ws.qaSubs.set(subId, filters);
			log('REQ', subId, JSON.stringify(filters));
			const delayedId = delayedAncestorHit(filters);
			if (delayedId) {
				log(
					`delaying ancestor ${delayedId.slice(0, 12)} for sub ${subId} by ${ANCESTOR_DELAY_MS}ms`
				);
				setTimeout(() => {
					servedDelayedIds.add(delayedId);
					serveMatches(ws, subId, filters);
					log(`served delayed ancestor ${delayedId.slice(0, 12)} to ${subId}`);
				}, ANCESTOR_DELAY_MS);
				return;
			}
			if (repliesHit(filters)) {
				repliesServed = true;
				log(`delaying replies for sub ${subId} by ${REPLY_DELAY_MS}ms`);
				setTimeout(() => {
					serveMatches(ws, subId, filters);
					log(`served delayed replies to ${subId}`);
				}, REPLY_DELAY_MS);
				return;
			}
			serveMatches(ws, subId, filters);
		} else if (type === 'EVENT') {
			const event = rest[0];
			if (event && event.id && !events.some((stored) => stored.id === event.id)) {
				events.push(event);
			}
			send(ws, ['OK', event?.id ?? '', true, '']);
		} else if (type === 'CLOSE') {
			ws.qaSubs.delete(rest[0]);
		}
	});
	ws.on('close', () => {
		ws.qaSubs.clear();
		log('connection closed');
	});
	ws.on('error', () => {});
});

server.listen(PORT, '0.0.0.0', () => {
	log(`listening on ws://127.0.0.1:${PORT} (emulator: ${RELAY_URL})`);
	log(`runid ${RUNID}, ancestor delay ${ANCESTOR_DELAY_MS}ms`);
	log(`root ${rootEvent.id.slice(0, 12)} A ${ancestorA.id.slice(0, 12)} B ${ancestorB.id.slice(0, 12)} F ${focusedEvent.id.slice(0, 12)}`);
	console.log(`QA_THREAD_NSEC=${nip19.nsecEncode(userSec)}`);
	console.log(
		`QA_THREAD_NEVENT=${nip19.neventEncode({ id: focusedEvent.id, relays: [RELAY_URL], author: focusedEvent.pubkey })}`
	);
	console.log(`QA_THREAD_RUNID=${RUNID}`);
});

// --- Kind 10002 publish ------------------------------------------------------

const relayList = finalizeEvent(
	{
		kind: 10002,
		created_at: nowSeconds(),
		tags: [['r', RELAY_URL]],
		content: ''
	},
	userSec
);

const pool = new SimplePool();
Promise.allSettled(pool.publish(BOOTSTRAP_RELAYS, relayList)).then((results) => {
	results.forEach((result, index) => {
		log(
			`kind10002 -> ${BOOTSTRAP_RELAYS[index]}: ${result.status}` +
				(result.status === 'rejected' ? ` (${result.reason})` : '')
		);
	});
});
