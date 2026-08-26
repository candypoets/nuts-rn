import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const LOCAL_AGENT_DEVICE = resolve(PROJECT_ROOT, 'node_modules', '.bin', 'agent-device');
export const DEFAULT_ARTIFACT_ROOT = '/tmp/nuts-rn-agent-device-artifacts';

function safeSegment(value, label) {
	if (!/^[a-z0-9][a-z0-9-]*$/i.test(value)) {
		throw new Error(`${label} contains unsafe path characters: ${value}`);
	}
	return value;
}

export function requireAndroidSerial(env = process.env) {
	const serial = env.ANDROID_SERIAL?.trim();
	if (!serial) {
		throw new Error(
			'ANDROID_SERIAL is required for device QA so Nuts cannot take over another agent\'s emulator.'
		);
	}
	return serial;
}

export function agentDeviceEnv(serial, env = process.env) {
	return {
		...env,
		AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST: serial
	};
}

export function buildAgentDeviceArgs({ flow, outputRoot, serial, values = {}, timeoutMs }) {
	const args = [
		'test',
		flow,
		'--maestro',
		'--serial',
		serial,
		'--fail-fast',
		'--retries',
		'0',
		'--timeout',
		timeoutMs || '720000',
		'--metro-port',
		'8084',
		'--artifacts-dir',
		outputRoot,
		'--reporter',
		'default'
	];
	for (const [name, value] of Object.entries(values)) {
		if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
			throw new Error(`invalid Agent Device variable: ${name}`);
		}
		if (value !== undefined && value !== null) args.push('-e', `${name}=${String(value)}`);
	}
	return args;
}

export function transitiveFlowSource(flowPath, seen = new Set()) {
	const absolutePath = resolve(flowPath);
	if (seen.has(absolutePath)) return '';
	seen.add(absolutePath);
	const source = readFileSync(absolutePath, 'utf8');
	const included = [...source.matchAll(/runFlow:\s*([\w./-]+\.yaml)/g)].map((match) =>
		transitiveFlowSource(resolve(absolutePath, '..', match[1]), seen)
	);
	return [source, ...included].join('\n');
}

export function scenarioFromFlow(flow) {
	return basename(flow, '.yaml').replace(/[^a-z0-9-]+/gi, '-');
}

export function runAgentDeviceFlow({ flow, scenario = scenarioFromFlow(flow), values = {} }) {
	const serial = requireAndroidSerial();
	const flowPath = resolve(PROJECT_ROOT, flow);
	if (!existsSync(flowPath)) throw new Error(`Agent Device flow does not exist: ${flow}`);
	if (!existsSync(LOCAL_AGENT_DEVICE) && !process.env.AGENT_DEVICE_CLI) {
		throw new Error('Agent Device is not installed; run npm install first.');
	}

	const outputRoot = resolve(
		process.env.QA_AGENT_DEVICE_OUTPUT_ROOT || DEFAULT_ARTIFACT_ROOT,
		safeSegment(scenario, 'scenario')
	);
	// Never let a failed run leave old artifacts looking current.
	rmSync(outputRoot, { recursive: true, force: true });
	mkdirSync(outputRoot, { recursive: true });

	const flowSource = transitiveFlowSource(flowPath);
	const referencedValues = Object.fromEntries(
		Object.entries(values).filter(([name]) => flowSource.includes(`\${${name}}`))
	);
	const args = buildAgentDeviceArgs({
		flow,
		outputRoot,
		serial,
		values: referencedValues,
		timeoutMs: process.env.QA_AGENT_DEVICE_TIMEOUT_MS
	});

	console.log(`\n>>> agent-device ${flow} on ${serial}`);
	try {
		execFileSync(process.env.AGENT_DEVICE_CLI || LOCAL_AGENT_DEVICE, args, {
			cwd: PROJECT_ROOT,
			env: agentDeviceEnv(serial),
			stdio: 'inherit',
			maxBuffer: 64 * 1024 * 1024
		});
	} catch (cause) {
		// Values may contain fixture signers and invite credentials. Do not
		// repeat the full argv in the thrown Node error.
		throw new Error(`Agent Device flow failed: ${flow} (${cause.status ?? 'unknown'})`);
	}
	console.log(`>>> ${flow} PASSED`);
	return outputRoot;
}
