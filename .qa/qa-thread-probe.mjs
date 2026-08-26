// QA thread probe: samples the agent-device accessibility snapshot and logs
// the screen rect of every node whose text mentions the QA runid ("QA ..."),
// so we can see whether the focused note's screen-Y stays constant while
// ancestor rows stream in above it.
//
// Usage: node .qa/qa-thread-probe.mjs [--duration-ms 60000] [--runid <id>]
// Output lines: <elapsedMs> <label> y=<top> h=<height>
import { execFile } from 'child_process';

function arg(name, fallback) {
	const index = process.argv.indexOf('--' + name);
	return index >= 0 ? process.argv[index + 1] : fallback;
}

const DURATION_MS = Number(arg('duration-ms', 60000));
const RUNID = arg('runid', '');
const startedAt = Date.now();

function snapshot() {
	return new Promise((resolve) => {
		execFile(
			'agent-device',
			['snapshot', '--json'],
			{ cwd: '/root/code/nuts-rn', maxBuffer: 16 * 1024 * 1024 },
			(error, stdout) => {
				if (error) return resolve(null);
				try {
					resolve(JSON.parse(stdout));
				} catch {
					resolve(null);
				}
			}
		);
	});
}

function label(text) {
	const head = text.split('\n')[0];
	return head.length > 44 ? head.slice(0, 44) : head;
}

async function main() {
	while (Date.now() - startedAt < DURATION_MS) {
		const elapsed = Date.now() - startedAt;
		const result = await snapshot();
		if (!result?.data?.nodes) {
			console.log(`${elapsed}\tSNAPSHOT_FAILED`);
			continue;
		}
		const hits = result.data.nodes.filter((node) => {
			const value =
				(typeof node.label === 'string' && node.label) ||
				(typeof node.text === 'string' && node.text) ||
				'';
			return value.includes('QA ') && (!RUNID || value.includes(RUNID));
		});
		if (!hits.length) {
			console.log(`${elapsed}\t(no QA nodes)`);
		}
		for (const node of hits) {
			const value = node.label || node.text || '';
			console.log(
				`${elapsed}\t${label(value)}\ty=${node.rect?.y}\th=${node.rect?.height}`
			);
		}
	}
}

main();
