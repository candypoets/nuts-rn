// Protocol-truth verifier for the invite-redeem e2e: the Maestro flow proves
// the app UI completes; this script proves the membership actually landed on
// the community relay.
//
//   1. kind 8 badge award with #p = the redeemer's pubkey, authored by the
//      community's badge_issuer_pubkey (the invite service key, NOT the
//      admin), referencing the required badge — the invite service publishes
//      this when it answers POST /redeem
//   2. kind 0 profile replica from the redeemer on the community relay — the
//      app publishes it as the last redeem step and awaits the relay's OK
//   3. 30009:<community-root>:members definition (the invite service publishes it at
//      startup; it is what makes the award render as membership)
//
// Usage: node .qa/qa-verify-redeem.mjs   (after the maestro redeem flow)
// Exit code is non-zero on any failure.
import {
	assert,
	getRelay,
	loadKeys,
	makePool,
	readCommunity,
	sleep
} from './qa-lib.mjs';

const community = readCommunity();
if (!community?.relay_url) {
	console.error(`no QA community state at ${process.env.QA_STATE || '/tmp/qa-rn-community.json'}`);
	console.error('run qa-bootstrap.mjs first');
	process.exit(1);
}
const keys = loadKeys();
const user = keys.users?.[0];
if (!user?.pub) throw new Error('keys file has no users[] (the maestro flow logs in as users[0])');

const RELAY = community.relay_url;
const pool = makePool();

async function queryUntil(filter, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const events = await pool.querySync([RELAY], filter);
		if (events.length) return events;
		await sleep(1500);
	}
	return [];
}

async function main() {
	console.log('community relay:', RELAY, `(${community.name})`);
	console.log('redeemer pubkey:', user.pub);

	// The award must be authored by the badge issuer service key.
	const relayView = await getRelay(community.id, keys);
	const issuer = relayView.badge_issuer_pubkey;
	assert(issuer, 'coordinator RelayView exposes badge_issuer_pubkey');
	assert(issuer !== keys.admin.pub, 'badge issuer is the service key, not the admin');

	// 1. kind 8 award for the redeemer.
	const awards = await queryUntil({ kinds: [8], authors: [issuer], '#p': [user.pub] });
	const award = awards.find((event) =>
		event.tags.some((tag) => tag[0] === 'p' && tag[1] === user.pub)
	);
	assert(award, 'kind 8 badge award for the redeemer exists on the community relay');
	assert(award.pubkey === issuer, 'award authored by the community badge_issuer_pubkey');
	if (relayView.required_badge) {
		assert(
			award.tags.some((tag) => tag[0] === 'a' && tag[1] === relayView.required_badge),
			`award references the required badge (${relayView.required_badge})`
		);
	}

	// 2. kind 0 replica published by the app as the last redeem step.
	const profiles = await queryUntil({ kinds: [0], authors: [user.pub], limit: 5 });
	assert(
		profiles.length > 0,
		"redeemer's kind-0 profile replicated to the community relay"
	);

	// 3. Membership definition the award references.
	const [, definitionAuthor, ...definitionDParts] = (relayView.required_badge || '').split(':');
	const definitionD = definitionDParts.join(':');
	const definitions = await queryUntil({
		kinds: [30009],
		authors: [definitionAuthor],
		'#d': [definitionD]
	});
	assert(
		definitions.length > 0,
		'root-authored NIP-97 membership definition is on the community relay'
	);

	pool.destroy([RELAY]);
	console.log('VERIFY PASS');
	process.exit(0);
}

main().catch((error) => {
	console.error('VERIFY FAIL:', error.message);
	try {
		pool.destroy([RELAY]);
	} catch {}
	process.exit(1);
});
