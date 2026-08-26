// Bootstrap a fresh QA community for the nuts-rn invite-redeem e2e and mint an
// invite for it, then hand everything to the downstream scripts via the state
// file (QA_STATE, default /tmp/qa-rn-community.json).
//
//   node .qa/qa-bootstrap.mjs
//
// Steps:
//   1. Provision a real strfry-badge-relay-node container via the coordinator
//      API (DEV_DIRECT_PORTS mode: ws relay + http invite service on separate
//      loopback ports)
//   2. Plant the admin kind-0 on the relay (--api provisioning never does this)
//   3. Mint an invite directly: POST {base_url}/invites with a NIP-98 auth
//      header signed with the admin key (mirrors nuts-cash
//      src/routes/admin/invites/+page.svelte createInvite())
//   4. Make sure the redeem proxy is running (qa-redeem-proxy.mjs) — the app
//      derives both the redeem endpoint and the community ws relay from the
//      invite link's relay= param, so in dev both must be reachable through
//      one origin
//   5. Write the state file and print the claim URL + Agent Device command
//
// Requires the local coordinator in DEV_DIRECT_PORTS mode (see .qa/README.md).
// Tear down afterwards with: node .qa/qa-teardown.mjs
import {
	assert,
	createRelayViaApi,
	ensureProxy,
	loadKeys,
	makePool,
	nip98Header,
	PROXY_EMULATOR_URL,
	requireCoordinator,
	signEvent,
	sleep,
	waitRelayRunning,
	writeCommunity
} from './qa-lib.mjs';

// NOTE: the domain label must NOT start with "qa-" — the nuts-cash
// .qa/qa-teardown.mjs --sweep janitor deletes every relay whose domain starts
// with "qa-", and it has already eaten one of these communities mid-run.
const keys = loadKeys();
const run = Date.now().toString(36);
const communityName = `QA RN Cafe ${run}`;
const domainLabel = `rnqa-cafe-${run}`;

await requireCoordinator();

// 1. Provision the community relay container.
const created = await createRelayViaApi(
	{
		name: communityName,
		description: 'nuts-rn QA redeem community - safe to delete.',
		domain_label: domainLabel,
		admin_pubkeys: [keys.admin.pub],
		badge_d: 'members'
	},
	keys
);
const relay = await waitRelayRunning(created.id, keys);
assert(relay.relay_url.startsWith('ws'), `relay running at ${relay.relay_url}`);
assert(relay.base_url.startsWith('http'), `invite service at ${relay.base_url}`);

// 2. Plant the admin kind-0 (api provisioning never publishes it). The gate
// accepts any event signed by an admin pubkey — but only once the container's
// write gate is actually serving; the coordinator reports "running" before
// that, so retry the publish until it round-trips.
const pool = makePool();
const profile = signEvent(
	{
		kind: 0,
		tags: [],
		content: JSON.stringify({ name: 'QA Admin', about: 'QA bootstrap admin profile' })
	},
	keys.admin.priv
);
let stored;
const deadline = Date.now() + 45000;
while (Date.now() < deadline && !stored) {
	await Promise.allSettled(pool.publish([relay.relay_url], profile));
	await sleep(1500);
	stored = await pool.get([relay.relay_url], { kinds: [0], authors: [keys.admin.pub] });
}
pool.close([relay.relay_url]);
assert(stored, 'admin kind-0 round-trips on the new relay');

// 3. Mint the invite. The invite service verifies NIP-98 (kind 27235, u tag =
// {NIP98_BASE_URL}/invites = {base_url}/invites) from an admin pubkey.
const inviteEndpoint = `${relay.base_url.replace(/\/+$/, '')}/invites`;
const inviteBody = JSON.stringify({ expires_in_seconds: 86400, max_redemptions: 1 });
const inviteResponse = await fetch(inviteEndpoint, {
	method: 'POST',
	headers: {
		authorization: nip98Header(inviteEndpoint, 'POST', inviteBody, keys.admin.priv),
		'content-type': 'application/json'
	},
	body: inviteBody
});
const invite = await inviteResponse.json().catch(() => undefined);
if (!inviteResponse.ok) {
	throw new Error(
		`POST /invites -> ${inviteResponse.status}: ${invite?.error || invite?.message || 'unknown'}`
	);
}
assert(invite?.token, 'invite minted (token returned)');

// 4. The app talks to the proxy on 10.0.2.2 (emulator host loopback); it
// routes POST /redeem to the invite service and everything else (NIP-11, ws)
// to the strfry port.
await ensureProxy();

// 5. Persist state.
const claimUrl = `nutsrn://redeem?relay=${encodeURIComponent(PROXY_EMULATOR_URL)}&token=${invite.token}`;
writeCommunity({
	id: created.id,
	relay_url: relay.relay_url,
	base_url: relay.base_url,
	domain: relay.domain,
	name: communityName,
	admin_pubkey: keys.admin.pub,
	user_pubkey: keys.users?.[0]?.pub,
	token: invite.token,
	invite_expires_at: invite.expires_at,
	claim_url: claimUrl,
	proxy_url: PROXY_EMULATOR_URL,
	via: 'api',
	run
});

console.log('');
console.log('claim URL:', claimUrl);
console.log('');
console.log('next:');
console.log(
	`  ANDROID_SERIAL=<serial> npm run qa:device -- maestro/flows/redeem-fresh.yaml -e TOKEN=${invite.token}` +
		` -e COMMUNITY_NAME="${communityName}" -e RELAY_PORT=7820 -e NSEC=<users[0].nsec>`
);
console.log('  node .qa/qa-verify-redeem.mjs');
console.log('BOOTSTRAP PASS');
process.exit(0);
