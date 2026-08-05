// Checkout shim: local stand-in for https://nuts.cash/api/stripe/checkout,
// for the RN store flows that are pointed here via
// EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:7821.
//
//   POST /api/stripe/checkout  {community, eventAddress, returnTo} + NIP-98
//     - parses + sanity-checks the NIP-98 header (signature, kind, method,
//       payload hash, staleness; SKIPS the strict u-tag origin check — the
//       app signs against 10.0.2.2:7821, production signs against nuts.cash)
//     - maps `community` (a ws URL, usually ws://10.0.2.2:7820|7822) to the
//       community in /tmp/qa-rn-commerce.json and re-fetches the NIP-97
//       definition from that community's strfry port directly
//     - applies the same catalog validation as nuts-cash
//       src/routes/api/stripe/checkout/+server.ts (sellable, available,
//       product max_uses=1 + valid product_kind, pass integer max_uses,
//       membership billing + no max_uses, payable price)
//     - performs the REAL /redeem payment POST against the community's
//       invite service, NIP-98-signed by the payment-service key
//       (recipient = the NIP-98 signer pubkey, definition_event_id = the
//       fetched event id, badge_address = eventAddress, purchase_type = the
//       definition type)
//     - returns {url: 'http://10.0.2.2:7821/checkout/success'}
//   GET /checkout/success     minimal success page (the app opens it)
//   GET /healthz
//
// Every checkout is logged as `[checkout] ...` on stdout — when the shim is
// spawned detached by qa-scenario-commerce.mjs, stdout appends to
// /tmp/qa-rn-checkout-shim.log; the maestro verifier greps that file.
//
// Run standalone or let qa-scenario-commerce.mjs spawn it detached.
import http from 'http';
import { makePool } from './qa-lib.mjs';
import {
	COMMERCE_STATE_PATH,
	decodeNip98,
	hasTagValue,
	paymentRedemption,
	readCommerceState,
	SHIM_HOST,
	SHIM_PORT,
	tagValue
} from './qa-commerce.mjs';

const PRODUCT_KINDS = new Set(['food', 'drink', 'merchandise', 'generic']);
const MEMBERSHIP_BILLING = new Set(['one_time', 'monthly', 'yearly']);
const DIRECT_TYPES = new Set(['membership', 'product', 'pass']);

class CheckoutError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

// Maps the `community` ws URL the app sends to the commerce-state community.
// The app talks to the proxies (ws://10.0.2.2:7820|7822); the shim fetches
// from the strfry port directly. Falls back to rewriting 10.0.2.2 to
// 127.0.0.1 (through the proxy ws leg) when the port matches nothing.
function resolveCommunity(community) {
	const state = readCommerceState();
	const entries = Object.entries(state?.communities || {});
	let url;
	try {
		url = new URL(community.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'));
	} catch {
		throw new CheckoutError(400, 'Invalid community URL');
	}
	const port = Number(url.port);
	for (const [, entry] of entries) {
		if (entry.proxy_port === port) return entry;
		const relayPort = Number(new URL(entry.relay_url.replace(/^ws/, 'http')).port);
		if (relayPort === port) return entry;
	}
	if (url.hostname === '10.0.2.2') url.hostname = '127.0.0.1';
	const relayUrl = url.toString().replace(/^http/, 'ws');
	console.warn(`[checkout] community ${community} not in commerce state — using it verbatim`);
	return { relay_url: relayUrl, base_url: undefined };
}

async function fetchDefinition(relayUrl, kind, author, identifier) {
	const pool = makePool();
	try {
		return await pool.get(
			[relayUrl],
			{ kinds: [kind], authors: [author], '#d': [identifier], limit: 1 },
			{ maxWait: 5000 }
		);
	} finally {
		pool.destroy([relayUrl]);
	}
}

// NIP-97 validation for direct catalog definitions.
function validateDefinition(definition, purchaseType, eventAddress) {
	const tags = definition.tags;
	const topic = purchaseType === 'event' ? 'ticket' : purchaseType;
	if (!hasTagValue(tags, 't', topic) || !tagValue(tags, 'price')) {
		throw new CheckoutError(422, 'Badge definition is not a buyable store item');
	}
	if (definition.kind === 30402 && tagValue(tags, 'status') !== 'active') {
		throw new CheckoutError(422, 'This badge is not currently available for purchase');
	}
	if (purchaseType === 'product') {
		const productKind = tagValue(tags, 'product_kind') || 'generic';
		const rawMaxUses = tagValue(tags, 'max_uses');
		if (!PRODUCT_KINDS.has(productKind) || (rawMaxUses && rawMaxUses !== '1')) {
			throw new CheckoutError(422, 'Product definition must represent one redeemable item');
		}
	}
	if (purchaseType === 'pass') {
		const rawMaxUses = tagValue(tags, 'max_uses');
		if (rawMaxUses && (!/^[1-9]\d*$/.test(rawMaxUses) || !Number.isSafeInteger(Number(rawMaxUses)))) {
			throw new CheckoutError(422, 'Pass definition has invalid usage limits');
		}
	}
	if (purchaseType === 'membership') {
		const rawBilling = tagValue(tags, 'billing') || 'one_time';
		if (!MEMBERSHIP_BILLING.has(rawBilling) || Boolean(tagValue(tags, 'max_uses'))) {
			throw new CheckoutError(422, 'Membership definition is invalid');
		}
	}
	const priceTag = tags.find((tag) => tag[0] === 'price');
	const currency = (priceTag?.[2] || '').toLowerCase();
	if (!priceTag?.[1] || !/^[a-z]{3}$/.test(currency)) {
		throw new CheckoutError(422, 'This item has no payable price');
	}
	if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(priceTag[1]) || Number(priceTag[1]) <= 0) {
		throw new CheckoutError(422, 'Catalog price is invalid');
	}
	// The badge address the award will reference.
	if (eventAddress !== `${definition.kind}:${definition.pubkey}:${tagValue(tags, 'd')}`) {
		throw new CheckoutError(400, 'Item address does not match the fetched definition');
	}
}

async function handleCheckout(req, res, body) {
	let authEvent;
	try {
		authEvent = decodeNip98(req.headers.authorization, body);
	} catch (error) {
		throw new CheckoutError(401, error.message);
	}
	const buyer = authEvent.pubkey;

	let input;
	try {
		input = JSON.parse(body);
	} catch {
		throw new CheckoutError(400, 'Invalid JSON body');
	}
	if (!input.community || !input.eventAddress) {
		throw new CheckoutError(400, 'Community and item are required');
	}
	const [kindValue, author, ...identifierParts] = String(input.eventAddress).split(':');
	const kind = Number(kindValue);
	const identifier = identifierParts.join(':');
	if (![30009, 30402].includes(kind) || !/^[0-9a-f]{64}$/i.test(author || '') || !identifier) {
		throw new CheckoutError(400, 'Invalid item address (the shim sells catalog items directly)');
	}

	const community = resolveCommunity(input.community);
	const definition = await fetchDefinition(community.relay_url, kind, author, identifier);
	if (!definition) throw new CheckoutError(404, 'Item not found on the community relay');
	const purchaseType = definition.tags.some((tag) => tag[0] === 't' && tag[1] === 'membership')
		? 'membership'
		: definition.tags.some((tag) => tag[0] === 't' && tag[1] === 'product')
			? 'product'
			: definition.tags.some((tag) => tag[0] === 't' && tag[1] === 'pass')
				? 'pass'
				: '';
	if ((purchaseType === 'membership') !== (kind === 30009)) {
		throw new CheckoutError(422, 'Catalog definition kind does not match its type');
	}
	if (!DIRECT_TYPES.has(purchaseType)) {
		throw new CheckoutError(422, 'Badge definition is not a buyable store item');
	}
	validateDefinition(definition, purchaseType, input.eventAddress);
	if (!community.base_url) {
		throw new CheckoutError(502, 'Community is not in the commerce state — cannot redeem');
	}

	// The real fulfillment: payment redemption against the invite service.
	const redemption = await paymentRedemption({
		baseUrl: community.base_url,
		definitionEventId: definition.id,
		badgeAddress: input.eventAddress,
		recipientPubkey: buyer,
		purchaseType
	});

	// The maestro verifier greps for this line.
	console.log(
		`[checkout] community=${community.name || input.community} item=${input.eventAddress} ` +
			`type=${purchaseType} buyer=${buyer} award=${redemption.event_id} ` +
			`redemption=${redemption.redemption_id}`
	);
	return {
		url: `http://10.0.2.2:${SHIM_PORT}/checkout/success?award=${redemption.event_id}`
	};
}

const SUCCESS_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Payment successful</title>
<style>body{font-family:system-ui;background:#101418;color:#e8ecef;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
main{text-align:center}h1{font-size:1.4rem}p{color:#9aa4ad}</style></head>
<body><main><h1>Payment successful</h1><p>Your purchase was fulfilled. You can return to the app.</p></main></body></html>`;

const server = http.createServer(async (req, res) => {
	const url = new URL(req.url, `http://${SHIM_HOST}:${SHIM_PORT}`);
	if (req.method === 'GET' && url.pathname === '/healthz') {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ ok: true, state: COMMERCE_STATE_PATH }));
		return;
	}
	if (req.method === 'GET' && url.pathname === '/checkout/success') {
		console.log(`[checkout] success page viewed award=${url.searchParams.get('award') || ''}`);
		res.writeHead(200, { 'content-type': 'text/html' });
		res.end(SUCCESS_PAGE);
		return;
	}
	if (req.method === 'POST' && url.pathname === '/api/stripe/checkout') {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const body = Buffer.concat(chunks).toString('utf8');
		try {
			const result = await handleCheckout(req, res, body);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(result));
		} catch (error) {
			const status = error instanceof CheckoutError ? error.status : 500;
			console.error(`[checkout] failed: ${status} ${error.message}`);
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ error: error.message }));
		}
		return;
	}
	res.writeHead(404, { 'content-type': 'application/json' });
	res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(SHIM_PORT, SHIM_HOST, () => {
	console.log(`checkout shim listening on http://${SHIM_HOST}:${SHIM_PORT}`);
	console.log(`  POST /api/stripe/checkout (state: ${COMMERCE_STATE_PATH})`);
	console.log(`  app entrypoint: EXPO_PUBLIC_NUTS_API_URL=http://10.0.2.2:${SHIM_PORT}`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
