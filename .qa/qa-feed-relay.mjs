// QA feed relay: a throwaway in-memory NIP-01 relay for the Explore device flow
// tests (explore-new-posts.yaml).
//
// What it does:
//   1. Serves SEED_COUNT pre-seeded kind-1 notes ("QA feed seed N <runid>").
//   2. INJECT_MS after the first author-less kind-1 REQ (the Explore "all"
//      subscription), broadcasts one live note ("QA feed live <runid>") to
//      open subscriptions — the app must HOLD it behind the "N more posts"
//      header control instead of prepending it.
//   3. Publishes the QA user's kind 10002 (read+write = this relay) to the
//      app's BOOTSTRAP_RELAYS, so a fresh nsec login makes the account relay
//      set collapse to just this relay. Prints QA_FEED_NSEC for maestro -e.
//
// Run:  node .qa/qa-feed-relay.mjs [--port 7777] [--inject-ms 8000] [--seeds 8]
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

const PORT = Number(arg('port', 7777));
const INJECT_MS = Number(arg('inject-ms', 8000));
const SEED_COUNT = Number(arg('seeds', 8));
const RUNID = arg('runid', Date.now().toString(36));

const log = (...args) => console.log('[qa-feed-relay]', ...args);

// --- Keys + seed events ----------------------------------------------------

const userSec = generateSecretKey();
const userPub = getPublicKey(userSec);
const authorSecs = [generateSecretKey(), generateSecretKey(), generateSecretKey()];

const nowSeconds = () => Math.floor(Date.now() / 1000);
const events = [];

for (let index = 0; index < SEED_COUNT; index += 1) {
	events.push(
		finalizeEvent(
			{
				kind: 1,
				created_at: nowSeconds() - 600 + index * 30,
				tags: [],
				content: `QA feed seed ${index + 1} ${RUNID}`
			},
			authorSecs[index % authorSecs.length]
		)
	);
}

// --- Relay ------------------------------------------------------------------

function matchFilter(event, filter) {
	if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
	if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
	if (filter.ids && !filter.ids.some((id) => event.id.startsWith(id))) return false;
	if (filter.since && event.created_at < filter.since) return false;
	if (filter.until && event.created_at > filter.until) return false;
	return true;
}

function send(ws, message) {
	if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

let injectionArmed = false;
let injected = false;

function maybeArmInjection(subId, filters) {
	if (injectionArmed || injected) return;
	// The Explore "all" subscription id starts with "feedall" (baseSubId in
	// ExploreFeed) and its request is the only author-less bare kind-1 filter
	// in play (contacts/home requests carry authors or #tags).
	const isExploreAll =
		subId.startsWith('feedall') &&
		filters.some(
			(filter) =>
				Array.isArray(filter.kinds) &&
				filter.kinds.includes(1) &&
				!filter.authors &&
				!filter['#e'] &&
				!filter['#p'] &&
				!filter['#t']
		);
	if (!isExploreAll) return;
	injectionArmed = true;
	log(`explore subscription seen, injecting live note in ${INJECT_MS}ms`);
	setTimeout(() => {
		injected = true;
		const event = finalizeEvent(
			{
				kind: 1,
				created_at: nowSeconds(),
				tags: [],
				content: `QA feed live ${RUNID}`
			},
			authorSecs[0]
		);
		events.push(event);
		broadcast(event);
		log('injected live note', event.id.slice(0, 12));
	}, INJECT_MS);
}

function broadcast(event) {
	for (const client of wss.clients) {
		if (client.readyState !== WebSocket.OPEN || !client.qaSubs) continue;
		for (const [subId, filters] of client.qaSubs) {
			if (filters.some((filter) => matchFilter(event, filter))) {
				send(client, ['EVENT', subId, event]);
			}
		}
	}
}

const server = createServer((req, res) => {
	if ((req.headers.accept || '').includes('application/nostr+json')) {
		// Deliberately no `name`: relay UIs then fall back to the URL label
		// "10.0.2.2:<port>", which the maestro flow asserts on.
		res.writeHead(200, { 'content-type': 'application/nostr+json' });
		res.end(
			JSON.stringify({
				description: 'QA Explore feed test relay',
				pubkey: userPub,
				software: 'qa-feed-relay',
				supported_nips: [1, 11]
			})
		);
		return;
	}
	res.writeHead(200, { 'content-type': 'text/plain' });
	res.end('qa-feed-relay\n');
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
			const seen = new Set();
			for (const filter of filters) {
				const matching = events
					.filter((event) => matchFilter(event, filter))
					.sort((a, b) => b.created_at - a.created_at)
					.slice(0, filter.limit ?? 5000);
				for (const event of matching) {
					if (seen.has(event.id)) continue;
					seen.add(event.id);
					send(ws, ['EVENT', subId, event]);
				}
			}
			send(ws, ['EOSE', subId]);
			maybeArmInjection(subId, filters);
		} else if (type === 'EVENT') {
			const event = rest[0];
			if (event && event.id && !events.some((stored) => stored.id === event.id)) {
				events.push(event);
				broadcast(event);
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
	log(`listening on ws://127.0.0.1:${PORT} (emulator: ws://10.0.2.2:${PORT})`);
	log(`seeded ${events.length} notes, runid ${RUNID}`);
	console.log(`QA_FEED_NSEC=${nip19.nsecEncode(userSec)}`);
});

// --- Kind 10002 publish ------------------------------------------------------

const relayList = finalizeEvent(
	{
		kind: 10002,
		created_at: nowSeconds(),
		tags: [['r', `ws://10.0.2.2:${PORT}`]],
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
