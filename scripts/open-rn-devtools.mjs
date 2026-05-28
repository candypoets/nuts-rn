import { execFile } from 'node:child_process';

const metroUrl = process.env.METRO_URL ?? 'http://localhost:8081';
const preferred = process.argv.slice(2).join(' ').toLowerCase();

async function main() {
  const response = await fetch(`${metroUrl}/json/list`);
  if (!response.ok) {
    throw new Error(`Metro inspector returned ${response.status}`);
  }

  const targets = await response.json();
  const rnTargets = targets.filter((target) => target.reactNative && target.devtoolsFrontendUrl);

  if (rnTargets.length === 0) {
    throw new Error('No React Native inspector targets found. Is the dev client open and connected to Metro?');
  }

  const target =
    (preferred &&
      rnTargets.find((candidate) =>
        `${candidate.title ?? ''} ${candidate.deviceName ?? ''}`.toLowerCase().includes(preferred),
      )) ||
    rnTargets.find((candidate) => `${candidate.deviceName ?? ''}`.toLowerCase().includes('iphone')) ||
    rnTargets[0];

  const url = new URL(target.devtoolsFrontendUrl, metroUrl).toString();
  console.log(`Opening React Native DevTools for ${target.deviceName ?? target.title}`);
  console.log(url);

  execFile('open', [url], (error) => {
    if (error) {
      throw error;
    }
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
