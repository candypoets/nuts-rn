// Commerce scenario seeder: provisions TWO strfry-badge communities on the
// local coordinator and seeds them for the store/orders/events QA flows.
//
//   node .qa/qa-scenario-commerce.mjs
//
//   - "QA RN Bar <runid>" (anchor extension type=hospitality), proxy :7820
//       catalog: product "QA Beer", 5.00 EUR, section "Drinks",
//                product_kind drink, max_uses 1, sellable, available
//   - "QA RN Gym <runid>" (anchor extension type=sports), proxy :7822
//       catalog: pass "QA 10-Session Pass", 49.00 EUR, max_uses 10
//       event:   "QA Training" (kind 31923, starts +2 days, 1h, capacity 2)
//   - both get an invite (max_redemptions 5) for the redeem-based flows
//   - starts one redeem proxy per community (7820 hospitality, 7822 sports)
//     plus the checkout shim on :7821 (qa-checkout-shim.mjs)
//
// State layout: everything goes to /tmp/qa-rn-commerce.json under
// `communities.hospitality` / `communities.sports`. The hospitality entry is
// ALSO written to the legacy single-community file /tmp/qa-rn-community.json
// so qa-verify-redeem.mjs and the redeem maestro flows keep working
// unchanged against the Bar.
//
// The app reaches the communities from the emulator through
// http://10.0.2.2:7820 / :7822 and the checkout shim through
// EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:7821.
//
// Tear down afterwards with: node .qa/qa-teardown.mjs
import {
	assert,
	createRelayViaApi,
	loadKeys,
	makePool,
	nip98Header,
	requireCoordinator,
	signEvent,
	sleep,
	waitRelayRunning,
	writeCommunity
} from './qa-lib.mjs';
import {
	calendarEvent,
	catalogDefinition,
	COMMERCE_STATE_PATH,
	communityAnchor,
	communityProxyEmulatorUrl,
	communityProxyPort,
	ensureCheckoutShim,
	ensureCommunityProxy,
	eventAddress,
	PAYMENT_SERVICE_PUBKEY,
	publishUntilStored,
	SHIM_EMULATOR_URL,
	writeCommerceState
} from './qa-commerce.mjs';

const keys = loadKeys();
const run = Date.now().toString(36);
const pool = makePool();

await requireCoordinator();

async function provisionCommunity({ key, name, domainLabel, profileType }) {
	console.log(`--- provisioning ${name} (${key})`);
	const created = await createRelayViaApi(
		{
			name,
			description: 'nuts-rn QA commerce community - safe to delete.',
			domain_label: domainLabel,
			admin_pubkeys: [keys.admin.pub],
			badge_d: 'members'
		},
		keys
	);
	const relay = await waitRelayRunning(created.id, keys);
	assert(relay.relay_url.startsWith('ws'), `relay running at ${relay.relay_url}`);
	assert(relay.base_url.startsWith('http'), `invite service at ${relay.base_url}`);

	// Plant the admin kind-0 (api provisioning never publishes it) — retried
	// until the container's write gate actually serves.
	const profile = signEvent(
		{
			kind: 0,
			tags: [],
			content: JSON.stringify({ name: 'QA Admin', about: 'QA commerce admin profile' })
		},
		keys.admin.priv
	);
	await publishUntilStored(pool, relay.relay_url, profile, {
		kinds: [0],
		authors: [keys.admin.pub]
	});

	// Replace the bootstrap anchor with a root-signed NIP-97 anchor carrying
	// the Nuts-only display archetype extension used by the RN store UI.
	assert(
		/^[0-9a-f]{64}$/i.test(created.community_root_secret_key || ''),
		'coordinator returned the one-time community root secret'
	);
	await sleep(1100);
	const anchor = communityAnchor(
		{
			admins: [relay.community_root_pubkey, keys.admin.pub],
			badgeIssuer: relay.badge_issuer_pubkey,
			name,
			type: profileType,
			description: `${name} — QA commerce seed`
		},
		created.community_root_secret_key
	);
	await publishUntilStored(pool, relay.relay_url, anchor, {
		ids: [anchor.id]
	});

	return {
		key,
		id: created.id,
		relay_url: relay.relay_url,
		base_url: relay.base_url,
		domain: relay.domain,
		name,
		admin_pubkey: keys.admin.pub,
		user_pubkey: keys.users?.[0]?.pub,
		profile_type: profileType,
		proxy_port: communityProxyPort(key),
		proxy_url: communityProxyEmulatorUrl(key)
	};
}

async function seedCatalog(community, definitions) {
	const catalog = {};
	for (const input of definitions) {
		const event = catalogDefinition(input, keys.admin.priv, { relayUrl: community.relay_url });
		await publishUntilStored(pool, community.relay_url, event, { ids: [event.id] });
		const address = eventAddress(event);
		catalog[input.d] = {
			id: event.id,
			address,
			d: input.d,
			name: input.name,
			type: input.type,
			price: String(input.price),
			currency: input.currency,
			max_uses: input.type === 'product' ? 1 : (input.maxUses ?? null)
		};
		console.log(`ok - catalog item ${address} (${input.name})`);
	}
	return catalog;
}

async function mintInvite(community, maxRedemptions = 10) {
	const endpoint = `${community.base_url.replace(/\/+$/, '')}/invites`;
	const body = JSON.stringify({ expires_in_seconds: 86400, max_redemptions: maxRedemptions });
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			authorization: nip98Header(endpoint, 'POST', body, keys.admin.priv),
			'content-type': 'application/json'
		},
		body
	});
	const invite = await response.json().catch(() => undefined);
	if (!response.ok) {
		throw new Error(`POST /invites -> ${response.status}: ${invite?.error || 'unknown'}`);
	}
	assert(invite?.token, 'invite minted (token returned)');
	return invite;
}

// --- Bar (hospitality) ---------------------------------------------------------

const bar = await provisionCommunity({
	key: 'hospitality',
	name: `QA RN Bar ${run}`,
	domainLabel: `rnqa-bar-${run}`,
	profileType: 'hospitality'
});
bar.catalog = await seedCatalog(bar, [
	{
		d: 'qa-beer',
		type: 'product',
		name: 'QA Beer',
		description: 'QA seed beer — store checkout flow.',
		price: '5.00',
		currency: 'EUR',
		section: 'Drinks',
		productKind: 'drink'
	}
]);
{
	const invite = await mintInvite(bar);
	bar.token = invite.token;
	bar.invite_expires_at = invite.expires_at;
	bar.claim_url = `nutsrn://redeem?relay=${encodeURIComponent(bar.proxy_url)}&token=${invite.token}`;
}

// --- Gym (sports) ---------------------------------------------------------------

const gym = await provisionCommunity({
	key: 'sports',
	name: `QA RN Gym ${run}`,
	domainLabel: `rnqa-gym-${run}`,
	profileType: 'sports'
});
gym.catalog = await seedCatalog(gym, [
	{
		d: 'qa-10-session-pass',
		type: 'pass',
		name: 'QA 10-Session Pass',
		description: 'QA seed punch-card pass — check-in flow.',
		price: '49.00',
		currency: 'EUR',
		maxUses: 10
	}
]);
{
	const start = Math.floor(Date.now() / 1000) + 2 * 86400;
	const event = calendarEvent(
		{
			d: `qa-training-${run}`,
			title: 'QA Training',
			summary: 'QA seed training session — RSVP/capacity flow.',
			start,
			end: start + 3600,
			capacity: 2
		},
		keys.admin.priv
	);
	await publishUntilStored(pool, gym.relay_url, event, { ids: [event.id] });
	gym.event = {
		id: event.id,
		address: eventAddress(event),
		d: `qa-training-${run}`,
		title: 'QA Training',
		start,
		end: start + 3600,
		capacity: 2
	};
	console.log('ok - calendar event', gym.event.address, '(capacity 2)');
	const invite = await mintInvite(gym);
	gym.token = invite.token;
	gym.invite_expires_at = invite.expires_at;
	gym.claim_url = `nutsrn://redeem?relay=${encodeURIComponent(gym.proxy_url)}&token=${invite.token}`;
}

pool.destroy([bar.relay_url, gym.relay_url]);

// --- State + processes -------------------------------------------------------------

// State first: the proxies resolve their targets from it per request.
writeCommerceState({
	run,
	payment_service_pubkey: PAYMENT_SERVICE_PUBKEY,
	communities: { hospitality: bar, sports: gym }
});

await ensureCommunityProxy('hospitality', bar);
await ensureCommunityProxy('sports', gym);
await ensureCheckoutShim();

// Legacy single-community state for the hospitality community — keeps
// qa-verify-redeem.mjs and the redeem maestro flows working unchanged.
writeCommunity({
	id: bar.id,
	relay_url: bar.relay_url,
	base_url: bar.base_url,
	domain: bar.domain,
	name: bar.name,
	admin_pubkey: bar.admin_pubkey,
	user_pubkey: bar.user_pubkey,
	token: bar.token,
	invite_expires_at: bar.invite_expires_at,
	claim_url: bar.claim_url,
	proxy_url: bar.proxy_url,
	via: 'api',
	run
});

console.log('');
console.log('Bar (hospitality)  :', bar.proxy_url, '->', bar.relay_url);
console.log('  claim URL:', bar.claim_url);
console.log('Gym (sports)       :', gym.proxy_url, '->', gym.relay_url);
console.log('  claim URL:', gym.claim_url);
console.log('Checkout shim      :', SHIM_EMULATOR_URL, '(EXPO_PUBLIC_NUTS_API_URL for store flows)');
console.log('Commerce state     :', COMMERCE_STATE_PATH);
console.log('');
console.log('next:');
console.log('  node .qa/qa-verify-commerce.mjs');
console.log('  node .qa/qa-teardown.mjs   # when done');
console.log('SCENARIO PASS');
process.exit(0);
