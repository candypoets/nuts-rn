#!/usr/bin/env node
import { runAgentDeviceFlow } from './agent-device-runner.mjs';

const [flow, ...args] = process.argv.slice(2);
if (!flow) {
	console.error('usage: npm run qa:device -- <flow.yaml> [-e NAME=value ...]');
	process.exit(1);
}

const values = {};
for (let index = 0; index < args.length; index += 1) {
	const argument = args[index];
	const assignment = argument === '-e' ? args[++index] : argument;
	const match = assignment?.match(/^([A-Z][A-Z0-9_]*)=(.*)$/s);
	if (!match) throw new Error(`invalid flow argument: ${argument}`);
	values[match[1]] = match[2];
}

runAgentDeviceFlow({ flow, values });
