#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

import { runAgentDeviceFlow } from './agent-device-runner.mjs';
import { loadKeys, readCommunity } from './qa-lib.mjs';

if (readCommunity()?.id) {
	throw new Error(
		'an existing invite QA state is present; run node .qa/qa-teardown.mjs before starting a fresh claim'
	);
}

let provisioned = false;
let failure;
try {
	execFileSync(process.execPath, ['.qa/qa-bootstrap.mjs'], { stdio: 'inherit' });
	provisioned = true;

	const community = readCommunity();
	const user = loadKeys().users?.[0];
	if (!community?.token || !community?.name || !community?.proxy_url) {
		throw new Error('invite bootstrap did not write complete QA state');
	}
	if (!user?.nsec) throw new Error('keys file has no users[0].nsec');

	const relayPort = new URL(community.proxy_url).port;
	let deviceFailure;
	try {
		runAgentDeviceFlow({
			flow: 'maestro/flows/redeem-fresh.yaml',
			scenario: 'invite-redeem',
			values: {
				TOKEN: community.token,
				COMMUNITY_NAME: community.name,
				RELAY_PORT: relayPort,
				NSEC: user.nsec
			}
		});
	} catch (error) {
		deviceFailure = error;
		console.error('INVITE UI FAIL; running protocol verifier before teardown');
	}

	let protocolFailure;
	try {
		execFileSync(process.execPath, ['.qa/qa-verify-redeem.mjs'], { stdio: 'inherit' });
	} catch (error) {
		protocolFailure = error;
	}
	if (deviceFailure) throw deviceFailure;
	if (protocolFailure) throw protocolFailure;
	console.log('INVITE E2E PASS');
} catch (error) {
	failure = error;
} finally {
	if (provisioned) {
		try {
			execFileSync(process.execPath, ['.qa/qa-teardown.mjs'], { stdio: 'inherit' });
		} catch (teardownError) {
			failure ||= teardownError;
		}
	}
}

if (failure) throw failure;
