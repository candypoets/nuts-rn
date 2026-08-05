// Redeem proxy: bridges the dev port split for the RN invite-redeem flow.
//
// In production the invite service and the strfry ws relay share one origin,
// and the app derives both from the invite link's relay= param
// (src/nostr/invites.ts relayUrlFromBaseUrl). In dev (coordinator
// DEV_DIRECT_PORTS) they are two DIFFERENT loopback ports, so the app cannot
// reach both through a single URL. This proxy presents one origin on
// 127.0.0.1:7820 (reachable from the emulator as http://10.0.2.2:7820):
//
//   POST /redeem            -> the invite service (state file base_url)
//   everything else         -> the strfry port (state file relay_url):
//                              NIP-11 GET (accept: application/nostr+json)
//                              and the nostr websocket (Upgrade)
//
// Targets are re-read from the QA state file per request, so a re-bootstrap
// does not require restarting the proxy. Two state modes:
//
//   - default: the single-community file /tmp/qa-rn-community.json
//     (qa-bootstrap.mjs)
//   - QA_COMMUNITY_KEY=<key> (+ QA_COMMERCE_STATE, default
//     /tmp/qa-rn-commerce.json): pick communities.<key> from the
//     two-community commerce state (qa-scenario-commerce.mjs), so one proxy
//     instance per community can run on its own port (7820 / 7822)
//
// Run standalone (foreground) or let qa-bootstrap.mjs / qa-scenario-commerce.mjs
// spawn it detached:
//
//   node .qa/qa-redeem-proxy.mjs
import http from 'http';
import { readFileSync } from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import {
	assert,
	PROXY_HOST,
	PROXY_PORT,
	readCommunity
} from './qa-lib.mjs';

const COMMUNITY_KEY = process.env.QA_COMMUNITY_KEY || '';
const COMMERCE_STATE_PATH = process.env.QA_COMMERCE_STATE || '/tmp/qa-rn-commerce.json';

function targets() {
	let community;
	if (COMMUNITY_KEY) {
		try {
			const state = JSON.parse(readFileSync(COMMERCE_STATE_PATH, 'utf8'));
			community = state.communities?.[COMMUNITY_KEY];
		} catch {
			community = undefined;
		}
	} else {
		community = readCommunity();
	}
	if (!community?.base_url || !community?.relay_url) return undefined;
	const invite = new URL(community.base_url);
	const relay = new URL(community.relay_url.replace(/^ws/, 'http'));
	return {
		invite: { host: invite.hostname, port: Number(invite.port) },
		relay: { host: relay.hostname, port: Number(relay.port) }
	};
}

function proxyHttp(req, res, target) {
	const upstream = http.request(
		{
			host: target.host,
			port: target.port,
			path: req.url,
			method: req.method,
			headers: { ...req.headers, host: `${target.host}:${target.port}` }
		},
		(upstreamRes) => {
			res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
			upstreamRes.pipe(res);
		}
	);
	upstream.on('error', (error) => {
		console.error('[proxy] http error:', error.message);
		if (!res.headersSent) res.writeHead(502);
		res.end('redeem proxy upstream error');
	});
	req.pipe(upstream);
}

const server = http.createServer((req, res) => {
	if (req.url === '/healthz') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ ok: true, community_key: COMMUNITY_KEY || null, targets: targets() || null }));
		return;
	}
	const t = targets();
	if (!t) {
		res.writeHead(502, { 'content-type': 'text/plain' });
		res.end('redeem proxy: no QA community state (run qa-bootstrap.mjs first)');
		return;
	}
	// POST /redeem and GET /community/info are invite/community-service calls;
	// everything else is strfry traffic. /community/info carries the badge
	// issuer for the status-signer trust check (src/lib/communityTrust.ts).
	const toInvite =
		(req.method === 'POST' && req.url.startsWith('/redeem')) ||
		(req.method === 'GET' && req.url.startsWith('/community/info'));
	const target = toInvite ? t.invite : t.relay;
	proxyHttp(req, res, target);
});

// Websocket leg: message-level forwarding via the `ws` library on both sides.
// A raw TCP tunnel here turned out to be too fragile for the app's Rust
// transport, which routinely opens duplicate transports per relay and aborts
// one mid-handshake; the races surfaced as "Unexpected close, relay marked
// unreliable" in nipworker and a 30-60s publish cooldown that silently
// dropped the redeem publishes. `ws` gives both legs proper close handshake
// and ping/pong semantics, so a client abort becomes a clean upstream close.
const wss = new WebSocketServer({
	noServer: true,
	// Echo whatever subprotocol the client offers (nostr clients expect the
	// 'nostr' token back; a missing Sec-WebSocket-Protocol can fail strict
	// manual-handshake clients).
	handleProtocols: (protocols) => protocols.values().next().value ?? false
});

server.on('upgrade', (req, clientSocket, head) => {
	const t = targets();
	if (!t) {
		clientSocket.destroy();
		return;
	}
	console.log('[proxy] ws upgrade from', clientSocket.remoteAddress);
	wss.handleUpgrade(req, clientSocket, head, (client) => {
		const upstream = new WebSocket(`ws://${t.relay.host}:${t.relay.port}`, 'nostr');
		const queue = [];
		// send() on a not-open socket throws synchronously when no callback is
		// given; an unguarded forward after the far end closed would crash the
		// whole proxy (observed once after a redeem run).
		const forward = (socket, data, isBinary) => {
			try {
				if (socket.readyState === WebSocket.OPEN) socket.send(data, { binary: isBinary });
			} catch (error) {
				console.error('[proxy] ws forward dropped:', error.message);
			}
		};
		// Abnormal closes arrive as reserved codes (1005/1006) that ws.close()
		// rejects with a TypeError — uncaught, that kills the proxy (observed
		// when teardown deleted the relay container under live tunnels).
		const closeQuietly = (socket, code, reason) => {
			try {
				if (socket.readyState === WebSocket.OPEN) {
					const valid = Number.isInteger(code) && ((code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1014) || code >= 3000);
					socket.close(valid ? code : 1000, reason);
				}
			} catch {
				socket.terminate();
			}
		};

		upstream.on('open', () => {
			console.log('[proxy] ws upstream connected');
			for (const message of queue.splice(0)) forward(upstream, message, false);
		});
		// PROXY_TAP=1: log REQ/CLOSE frames from clients and 37237 EVENT frames
		// to clients — diagnoses live-sub delivery through the proxy.
		const TAP = process.env.PROXY_TAP === '1';
		const tap = (direction, data) => {
			if (!TAP) return;
			try {
				const msg = JSON.parse(data.toString());
				if (direction === 'in' && msg[0] === 'REQ') {
					const filters = msg
						.slice(2)
						.map(
							(f) =>
								`kinds=${JSON.stringify(f.kinds || [])}#e=${JSON.stringify((f['#e'] || []).map((x) => x.slice(0, 6)))}`
						)
						.join('|');
					console.log(`[tap] REQ ${msg[1]} ${filters}`);
				} else if (direction === 'in' && msg[0] === 'CLOSE') {
					console.log(`[tap] CLOSE ${msg[1]}`);
				} else if (direction === 'out' && msg[0] === 'EVENT' && msg[2]?.kind === 37237) {
					console.log(
						`[tap] EVENT 37237 -> client (sub ${msg[1]}, e=${msg[2].tags?.find((t) => t[0] === 'e')?.[1]?.slice(0, 6)})`
					);
				}
			} catch {
				/* non-JSON frame */
			}
		};
		upstream.on('message', (data, isBinary) => {
			tap('out', data);
			forward(client, data, isBinary);
		});
		upstream.on('close', (code, reason) => {
			console.log('[proxy] ws upstream closed', code, reason.toString());
			closeQuietly(client, code, reason);
		});
		upstream.on('error', (error) => {
			console.error('[proxy] ws upstream error:', error.message);
			closeQuietly(client, 1011, 'upstream error');
		});

		client.on('message', (data, isBinary) => {
			tap('in', data);
			if (upstream.readyState === WebSocket.CONNECTING) queue.push(data);
			else forward(upstream, data, isBinary);
		});
		client.on('close', (code, reason) => {
			console.log('[proxy] ws client closed', code, reason.toString());
			closeQuietly(upstream, code, reason);
		});
		client.on('error', (error) => {
			console.error('[proxy] ws client error:', error.message);
			closeQuietly(upstream, 1011, 'client error');
		});
	});
});

server.listen(PROXY_PORT, PROXY_HOST, () => {
	const t = targets();
	console.log(`redeem proxy listening on http://${PROXY_HOST}:${PROXY_PORT}`);
	if (t) {
		console.log(`  POST /redeem -> http://${t.invite.host}:${t.invite.port}`);
		console.log(`  ws / NIP-11  -> http://${t.relay.host}:${t.relay.port}`);
	} else {
		console.log('  (no QA community state yet — targets resolve per request)');
	}
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

// Sanity: the file is runnable as-is.
assert(typeof PROXY_PORT === 'number' && PROXY_PORT > 0, 'proxy port configured');
