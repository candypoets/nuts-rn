import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
	agentDeviceEnv,
	buildAgentDeviceArgs,
	requireAndroidSerial,
	transitiveFlowSource
} from './agent-device-runner.mjs';

test('requires an explicit Android serial to prevent cross-agent device takeover', () => {
	assert.throws(() => requireAndroidSerial({}), /ANDROID_SERIAL is required/);
	assert.equal(requireAndroidSerial({ ANDROID_SERIAL: 'emulator-5554' }), 'emulator-5554');
});

test('pins Agent Device to one device and the Nuts Metro port', () => {
	const args = buildAgentDeviceArgs({
		flow: 'maestro/flows/redeem.yaml',
		outputRoot: '/tmp/evidence/invite-redeem',
		serial: 'emulator-5554',
		values: { COMMUNITY_NAME: 'QA RN Cafe' }
	});
	assert.deepEqual(args.slice(0, 8), [
		'test',
		'maestro/flows/redeem.yaml',
		'--maestro',
		'--serial',
		'emulator-5554',
		'--fail-fast',
		'--retries',
		'0'
	]);
	assert.ok(args.includes('8084'));
	assert.ok(args.includes('COMMUNITY_NAME=QA RN Cafe'));
	assert.equal(
		agentDeviceEnv('emulator-5554', {}).AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST,
		'emulator-5554'
	);
});

test('rejects unsafe flow variable names', () => {
	assert.throws(
		() =>
			buildAgentDeviceArgs({
				flow: 'x',
				outputRoot: '/tmp/x',
				serial: 'x',
				values: { 'BAD-NAME': 'x' }
			}),
		/invalid Agent Device variable/
	);
});

test('collects variables from included compatibility flows', (context) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nuts-agent-device-flow-'));
	context.after(() => fs.rmSync(root, { recursive: true, force: true }));
	fs.writeFileSync(path.join(root, 'seed.yaml'), '- openLink: "nutsrn:///?relay=${RELAY_URL}"\n');
	fs.writeFileSync(path.join(root, 'screen.yaml'), '- runFlow: seed.yaml\n- assertVisible: "Ready"\n');
	const source = transitiveFlowSource(path.join(root, 'screen.yaml'));
	assert.match(source, /RELAY_URL/);
	assert.match(source, /Ready/);
});

test('invite flow avoids selector fields unsupported by Agent Device', () => {
	const source = transitiveFlowSource(path.resolve('maestro/flows/redeem-fresh.yaml'));
	assert.doesNotMatch(source, /^\s*(below|above|leftOf|rightOf):/m);
});

test('fresh invite flow cannot pass on invitation metadata alone', () => {
	const source = fs.readFileSync(path.resolve('maestro/flows/redeem-fresh.yaml'), 'utf8');
	assert.match(source, /visible: "Claim invite"/);
	assert.match(source, /notVisible: "Claim invite"/);
	assert.match(source, /assertNotVisible: ".*You're invited to\.\*"/);
});
