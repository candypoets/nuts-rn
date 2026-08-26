#!/usr/bin/env node
// Signup protocol-truth verifier: the Agent Device flow proves the wizard renders
// and completes; this script proves the events it publishes were actually
// accepted by at least one relay.
//
// The app logs `[signup-publish] start { sendId, kind, relays }` and
// `[signup-publish] relay status { sendId, kind, relay, status, message }`
// for every publish. Signup sends four publishes:
//   signup_profile_<ts>   kind 0
//   signup_wallet_<ts>    kind 17375
//   signup_trusted_mints  kind 10019
//   signup_follows_<ts>   kind 3
//
// Usage: node .qa/qa-verify-signup.mjs   (dumps `adb logcat -d`; run after
// the maestro signup flow, before anything clears logcat)

import { execSync } from 'node:child_process';

const PREFIXES = {
	signup_profile_: 0,
	signup_wallet_: 17375,
	signup_trusted_mints_: 10019,
	signup_follows_: 3
};

const logcat = execSync('adb logcat -d', { maxBuffer: 64 * 1024 * 1024 }).toString();
const allLines = logcat.split('\n');

// ReactNativeJS logs objects one property per line, so a "relay status" entry
// spans ~5 lines: sendId / kind / relay / status / message. Group each entry
// into a single block before matching.
const entries = [];
for (let i = 0; i < allLines.length; i++) {
	const line = allLines[i];
	if (!line.includes('signup-publish')) continue;
	const isStatus = line.includes('relay status');
	const isStart = line.includes('start');
	if (!isStatus && !isStart) continue;
	entries.push({
		type: isStatus ? 'status' : 'start',
		block: allLines.slice(i, i + 6).join('\n')
	});
}

if (entries.length === 0) {
	console.error('FAIL: no [signup-publish] lines in logcat — did the signup flow run?');
	process.exit(1);
}

// Status values seen from nipworker ConnectionStatus: 'SENT' then 'true'/'ok'
// on accept, 'false' with an error message on rejection.
const isAccepted = (block) => /status:\s*'(true|ok)'/.test(block);

let failed = false;
for (const [prefix, kind] of Object.entries(PREFIXES)) {
	const starts = entries.filter((e) => e.type === 'start' && e.block.includes(prefix));
	const statuses = entries.filter((e) => e.type === 'status' && e.block.includes(prefix));
	const accepted = statuses.filter((e) => isAccepted(e.block));
	if (starts.length === 0) {
		console.error(`FAIL: kind ${kind} (${prefix}) — publish never started`);
		failed = true;
	} else if (accepted.length === 0) {
		console.error(`FAIL: kind ${kind} (${prefix}) — ${statuses.length} relay status entries, none accepted`);
		for (const entry of statuses.slice(0, 3)) console.error('      ', entry.block.replace(/\n/g, ' | '));
		failed = true;
	} else {
		const relays = [...new Set(accepted.map((e) => e.block.match(/relay:\s*'([^']+)'/)?.[1]).filter(Boolean))];
		console.log(`ok: kind ${kind} (${prefix}) — accepted by ${relays.join(', ') || `${accepted.length} relay(s)`}`);
	}
}

const pubkeyMatch = logcat.match(/prepared kind0 profile[\s\S]{0,200}?pubkey['":\s]+([0-9a-f]{64})/);
if (pubkeyMatch) console.log('signup pubkey:', pubkeyMatch[1]);

process.exit(failed ? 1 : 0);
