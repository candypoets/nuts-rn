// Tear down QA communities provisioned by qa-bootstrap.mjs (single community)
// or qa-scenario-commerce.mjs (two communities + proxies + checkout shim).
//
//   node .qa/qa-teardown.mjs           # delete the relays in the state files + their volumes
//   node .qa/qa-teardown.mjs --sweep   # delete ALL rnqa-* relays + orphan strfry volumes
//
// The coordinator's DELETE removes the container and DB record but NOT the
// named docker volume (strfry-badge-data-<id>) — removed here explicitly.
// Also stops the redeem proxy if qa-bootstrap.mjs spawned it, and removes the
// state file. --sweep is the crash-recovery janitor: use it after a run died
// mid-workflow.
import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync } from 'fs';
import {
	clearCommunity,
	deleteRelay,
	listRelays,
	loadKeys,
	PROXY_PID_PATH,
	readCommunity,
	requireCoordinator
} from './qa-lib.mjs';
import {
	COMMERCE_STATE_PATH,
	communityProxyPidPath,
	readCommerceState,
	SHIM_PID_PATH
} from './qa-commerce.mjs';

const sweep = process.argv.includes('--sweep');
const keys = loadKeys();

function removeVolume(id) {
	try {
		execFileSync('docker', ['volume', 'rm', '-f', `strfry-badge-data-${id}`], { stdio: 'pipe' });
		console.log('ok - removed volume strfry-badge-data-' + id);
	} catch {
		console.log('warn - volume strfry-badge-data-' + id + ' not removed (already gone?)');
	}
}

async function removeRelay(id, label) {
	try {
		await deleteRelay(id, keys);
		console.log('ok - deleted relay', id, label ? `(${label})` : '');
	} catch (error) {
		console.log('warn - relay delete failed for', id, '-', error.message.split('\n')[0]);
	}
	removeVolume(id);
}

function stopProxy() {
	if (!existsSync(PROXY_PID_PATH)) return;
	const pid = Number(readFileSync(PROXY_PID_PATH, 'utf8').trim());
	rmSync(PROXY_PID_PATH, { force: true });
	if (!pid) return;
	try {
		process.kill(pid, 'SIGTERM');
		console.log('ok - stopped redeem proxy (pid ' + pid + ')');
	} catch {
		console.log('warn - redeem proxy pid ' + pid + ' not running (already stopped?)');
	}
}

// Stops a detached helper process recorded in a pid file (commerce proxies,
// checkout shim).
function stopPidFile(pidPath, label) {
	if (!existsSync(pidPath)) return;
	const pid = Number(readFileSync(pidPath, 'utf8').trim());
	rmSync(pidPath, { force: true });
	if (!pid) return;
	try {
		process.kill(pid, 'SIGTERM');
		console.log(`ok - stopped ${label} (pid ${pid})`);
	} catch {
		console.log(`warn - ${label} pid ${pid} not running (already stopped?)`);
	}
}

function stopCommerceProcesses() {
	stopPidFile(communityProxyPidPath('hospitality'), 'hospitality proxy');
	stopPidFile(communityProxyPidPath('sports'), 'sports proxy');
	stopPidFile(SHIM_PID_PATH, 'checkout shim');
}

// Deletes both commerce communities (if any) and stops their processes.
// Returns true when a commerce state file was present.
async function teardownCommerce() {
	const state = readCommerceState();
	stopCommerceProcesses();
	rmSync(COMMERCE_STATE_PATH, { force: true });
	if (!state?.communities) return false;
	for (const community of Object.values(state.communities)) {
		if (community?.id) await removeRelay(community.id, community.name);
	}
	return true;
}

await requireCoordinator();

if (sweep) {
	const relays = await listRelays(keys);
	const qaRelays = relays.filter((relay) => (relay.domain || '').startsWith('rnqa-'));
	if (!qaRelays.length) console.log('ok - no rnqa-* relays to delete');
	for (const relay of qaRelays) {
		await removeRelay(relay.id, relay.name || relay.domain);
	}

	// Orphan volumes: relay id no longer present in the coordinator DB.
	const liveIds = new Set((await listRelays(keys)).map((relay) => relay.id));
	let volumes = [];
	try {
		volumes = execFileSync('docker', ['volume', 'ls', '--format', '{{.Name}}'])
			.toString()
			.split('\n')
			.filter((name) => name.startsWith('strfry-badge-data-'));
	} catch {
		console.log('warn - could not list docker volumes');
	}
	for (const volume of volumes) {
		const id = volume.replace('strfry-badge-data-', '');
		if (!liveIds.has(id)) {
			try {
				execFileSync('docker', ['volume', 'rm', '-f', volume], { stdio: 'pipe' });
				console.log('ok - removed orphan volume', volume);
			} catch {
				console.log('warn - could not remove volume', volume);
			}
		}
	}
	stopProxy();
	stopCommerceProcesses();
	rmSync(COMMERCE_STATE_PATH, { force: true });
	clearCommunity();
	console.log('SWEEP PASS');
	process.exit(0);
}

// The scenario writes the hospitality community to BOTH state files; capture
// the commerce relay ids before teardownCommerce removes the state file so
// the legacy delete below can skip a double delete.
const commerceIds = new Set(
	Object.values(readCommerceState()?.communities || {}).map((entry) => entry?.id)
);
const hadCommerce = await teardownCommerce();

const community = readCommunity();
if (!community?.id) {
	if (hadCommerce) {
		stopProxy();
		clearCommunity();
		console.log('TEARDOWN PASS');
		process.exit(0);
	}
	console.error(`no QA community state at ${process.env.QA_STATE || '/tmp/qa-rn-community.json'}`);
	console.error('run qa-bootstrap.mjs or qa-scenario-commerce.mjs first, or use --sweep to clean up by name');
	process.exit(1);
}

if (!hadCommerce || !commerceIds.has(community.id)) {
	await removeRelay(community.id, community.name);
}
stopProxy();
clearCommunity();
console.log('TEARDOWN PASS');
process.exit(0);
