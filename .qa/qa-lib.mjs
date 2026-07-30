// Shared helpers for the nuts-rn .qa harness: keys, NIP-98, coordinator API,
// community state file, relay pool, and the redeem proxy lifecycle.
// Adapted from nuts-cash/.qa/qa-lib.mjs (browser/dev-server helpers dropped —
// the app under test runs on the Android emulator, driven by Maestro).
import { spawn } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import WebSocket from 'ws';
import { useWebSocketImplementation, SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

useWebSocketImplementation(WebSocket);

export const COORDINATOR_URL = (process.env.COORDINATOR_URL || 'http://127.0.0.1:7798').replace(
	/\/$/,
	''
);
export const QA_STATE_PATH = process.env.QA_STATE || '/tmp/qa-rn-community.json';
// The coordinator only provisions for pubkeys in its COORDINATOR_ADMIN_PUBKEYS;
// the strfry-badge-node test env admin is whitelisted by convention.
export const DEFAULT_KEYS_JSON = '/root/code/strfry-badge-node/test/env/keys.json';

// The redeem proxy bridges the dev port split: the RN app derives both the
// invite service endpoint ({relay}/redeem) and the community ws relay from the
// invite link's single relay= param, but in dev those are two different
// loopback ports. See qa-redeem-proxy.mjs.
export const PROXY_PORT = Number(process.env.QA_PROXY_PORT || 7820);
export const PROXY_HOST = '127.0.0.1';
export const PROXY_PID_PATH = process.env.QA_PROXY_PID || '/tmp/qa-rn-redeem-proxy.pid';
// 10.0.2.2 = emulator host loopback (the app runs inside the emulator).
export const PROXY_EMULATOR_URL = `http://10.0.2.2:${PROXY_PORT}`;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const nowSeconds = () => Math.floor(Date.now() / 1000);

export function assert(condition, label) {
	if (!condition) throw new Error('ASSERT FAILED: ' + label);
	console.log('ok -', label);
}

// --- Keys -----------------------------------------------------------------

function normalizeKey(value) {
	return {
		priv: value.priv || value.sec_hex,
		pub: value.pub || value.pub_hex,
		nsec: value.nsec,
		npub: value.npub
	};
}

// Accepts both key file shapes in play: /tmp/qa-keys.json (priv/pub) and
// strfry-badge-node test/env/keys.json (sec_hex/pub_hex, users[] array).
export function loadKeys(path = process.env.KEYS_JSON || DEFAULT_KEYS_JSON) {
	const raw = JSON.parse(readFileSync(path, 'utf8'));
	const out = { _path: path };
	for (const [name, value] of Object.entries(raw)) {
		if (value && typeof value === 'object' && !Array.isArray(value) && (value.priv || value.sec_hex)) {
			out[name] = normalizeKey(value);
		}
	}
	if (Array.isArray(raw.users)) out.users = raw.users.map(normalizeKey);
	return out;
}

export function randomKey() {
	const priv = bytesToHex(generateSecretKey());
	return { priv, pub: getPublicKey(hexToBytes(priv)) };
}

// --- Signing ---------------------------------------------------------------

export function signEvent(template, privHex) {
	return finalizeEvent({ created_at: nowSeconds(), content: '', ...template }, hexToBytes(privHex));
}

export function makePool() {
	return new SimplePool();
}

// NIP-98 HTTP auth header (kind 27235). Signed at call time: verifiers apply a
// ~60s staleness window, so never cache these.
export function nip98Header(url, method, body, privHex) {
	const payloadHash = bytesToHex(sha256(new TextEncoder().encode(body || '')));
	const event = signEvent(
		{
			kind: 27235,
			tags: [
				['u', url],
				['method', method],
				['payload', payloadHash]
			]
		},
		privHex
	);
	const encoded = Buffer.from(JSON.stringify(event), 'utf8')
		.toString('base64')
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
	return `Nostr ${encoded}`;
}

// --- Coordinator API --------------------------------------------------------

export async function requireCoordinator() {
	try {
		const response = await fetch(COORDINATOR_URL + '/healthz', { signal: AbortSignal.timeout(3000) });
		if (!response.ok) throw new Error('status ' + response.status);
	} catch {
		throw new Error(
			`coordinator not reachable at ${COORDINATOR_URL}.\n` +
				'Start it in dev mode (strfry-badge-node/test/app/README.md):\n' +
				'  cd /root/code/strfry-badge-node && LISTEN_ADDR=127.0.0.1:7798 \\\n' +
				'  DB_PATH=test/app/coordinator-dev.sqlite3 RELAY_IMAGE=strfry-badge-relay-node:local \\\n' +
				'  RELAY_DOMAIN_SUFFIX=test.local NUTS_PAYMENT_SERVICE_PUBKEY=<64-hex> \\\n' +
				`  COORDINATOR_ADMIN_PUBKEYS=$(jq -r .admin.pub_hex test/env/keys.json) \\\n` +
				`  NIP98_BASE_URL=${COORDINATOR_URL} DEV_DIRECT_PORTS=true ./target/debug/strfry-badge-coordinator`
		);
	}
}

async function coordinatorApi(path, method, keys, body) {
	const url = COORDINATOR_URL + path;
	const bodyText = body === undefined ? '' : JSON.stringify(body);
	const response = await fetch(url, {
		method,
		headers: {
			authorization: nip98Header(url, method, bodyText, keys.admin.priv),
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: method === 'GET' || method === 'DELETE' ? undefined : bodyText
	});
	if (!response.ok) {
		throw new Error(`coordinator ${method} ${path} -> ${response.status}: ${await response.text()}`);
	}
	if (response.status === 204) return undefined;
	return response.json();
}

export const listRelays = (keys) => coordinatorApi('/relays', 'GET', keys);
export const getRelay = (id, keys) => coordinatorApi(`/relays/${id}`, 'GET', keys);
// Admin-only: { badge_issuer_secret_key, invite_secret } for a relay. Used to
// sign badge-issuer events (e.g. kind-5 award revocations) in protocol tests.
export const getRelaySecrets = (id, keys) => coordinatorApi(`/relays/${id}/secrets`, 'GET', keys);
export const deleteRelay = (id, keys) => coordinatorApi(`/relays/${id}`, 'DELETE', keys);
export const createRelayViaApi = (payload, keys) => coordinatorApi('/relays', 'POST', keys, payload);

export async function waitRelayRunning(id, keys, timeoutMs = 90000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const relay = await getRelay(id, keys);
		if (relay.status === 'running') return relay;
		if (relay.status !== 'creating') throw new Error(`relay ${id} stuck in status ${relay.status}`);
		await sleep(2000);
	}
	throw new Error(`relay ${id} did not reach running within ${timeoutMs}ms`);
}

// --- Community state file -----------------------------------------------------

export function readCommunity() {
	if (!existsSync(QA_STATE_PATH)) return undefined;
	return JSON.parse(readFileSync(QA_STATE_PATH, 'utf8'));
}

export function writeCommunity(data) {
	writeFileSync(
		QA_STATE_PATH,
		JSON.stringify({ ...data, state_written_at: new Date().toISOString() }, null, 2)
	);
	console.log('ok - wrote community state to', QA_STATE_PATH);
}

export function clearCommunity() {
	rmSync(QA_STATE_PATH, { force: true });
}

// --- Redeem proxy lifecycle ---------------------------------------------------

export async function proxyReachable() {
	try {
		const response = await fetch(`http://${PROXY_HOST}:${PROXY_PORT}/healthz`, {
			signal: AbortSignal.timeout(2000)
		});
		return response.ok;
	} catch {
		return false;
	}
}

// Starts qa-redeem-proxy.mjs detached (survives this process) unless one is
// already answering on the proxy port. Records the pid for qa-teardown.mjs.
export async function ensureProxy() {
	if (await proxyReachable()) {
		console.log(`ok - redeem proxy already up on :${PROXY_PORT}`);
		return;
	}
	const proxyPath = new URL('./qa-redeem-proxy.mjs', import.meta.url).pathname;
	const child = spawn(process.execPath, [proxyPath], {
		detached: true,
		stdio: ['ignore', 'ignore', 'ignore'],
		env: { ...process.env, QA_PROXY_PORT: String(PROXY_PORT), QA_PROXY_PID: PROXY_PID_PATH }
	});
	child.unref();
	writeFileSync(PROXY_PID_PATH, String(child.pid));

	const deadline = Date.now() + 10000;
	while (Date.now() < deadline) {
		if (await proxyReachable()) {
			console.log(`ok - redeem proxy started on :${PROXY_PORT} (pid ${child.pid})`);
			return;
		}
		await sleep(300);
	}
	throw new Error(`redeem proxy did not come up on :${PROXY_PORT}`);
}
