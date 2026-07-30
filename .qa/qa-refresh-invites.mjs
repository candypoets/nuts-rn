// Refresh the invite tokens in /tmp/qa-rn-commerce.json in place.
// Invites carry max_redemptions=10 and expire after 86400 s, so repeated
// verifier/flow runs exhaust them; minting a fresh token against the SAME
// community keeps the provisioned scenario usable (no re-provision).
import { readFileSync, writeFileSync } from 'fs';
import { loadKeys, nip98Header, assert } from './qa-lib.mjs';

const STATE = process.env.QA_COMMERCE_STATE || '/tmp/qa-rn-commerce.json';
const keys = loadKeys();
const state = JSON.parse(readFileSync(STATE, 'utf8'));

async function mintInvite(community, maxRedemptions = 25) {
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
	assert(response.ok && invite?.token, `POST /invites -> ${response.status}: ${invite?.error || 'unknown'}`);
	return invite;
}

for (const community of Object.values(state.communities)) {
	const invite = await mintInvite(community);
	community.token = invite.token;
	community.invite_expires_at = invite.expires_at;
	community.claim_url = `nutsrn://redeem?relay=${encodeURIComponent(community.proxy_url)}&token=${invite.token}`;
	console.log(`ok - fresh invite for ${community.name} (expires ${new Date(invite.expires_at * 1000).toISOString()})`);
}

state.state_written_at = new Date().toISOString();
writeFileSync(STATE, JSON.stringify(state, null, 1));
console.log('state updated:', STATE);
