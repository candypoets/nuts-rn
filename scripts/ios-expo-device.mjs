#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const deviceIndex = args.findIndex((arg) => arg === '--device' || arg === '-d');
const device = deviceIndex >= 0 ? args[deviceIndex + 1] : undefined;

function run(command, commandArgs, env = {}) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...env,
    },
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveDeviceId(nameOrId) {
  if (/^[0-9A-Fa-f-]{20,}$/.test(nameOrId) || nameOrId.includes('-')) {
    return nameOrId;
  }

  const result = spawnSync('xcrun', ['xctrace', 'list', 'devices'], {
    encoding: 'utf8',
    env: process.env,
  });

  if (result.status !== 0) {
    return nameOrId;
  }

  const pattern = /^(.+?) \([^)]*\) \(([0-9A-Fa-f-]{20,})\)$/;
  const requested = nameOrId.toLowerCase();

  for (const line of result.stdout.split('\n')) {
    const match = line.trim().match(pattern);
    if (match?.[1]?.toLowerCase() === requested) {
      return match[2];
    }
  }

  return nameOrId;
}

if (device && device !== 'generic') {
  const resolvedDevice = resolveDeviceId(device);
  const destination =
    /^[0-9A-Fa-f-]{20,}$/.test(resolvedDevice) || resolvedDevice.includes('-')
      ? `platform=iOS,id=${resolvedDevice}`
      : `platform=iOS,name=${resolvedDevice}`;

  run(
    'xcodebuild',
    [
      '-workspace',
      'ios/NutsRn.xcworkspace',
      '-scheme',
      'NutsRn',
      '-configuration',
      'Debug',
      '-destination',
      destination,
      'DEVELOPMENT_TEAM=4P9DXSMKF2',
      '-allowProvisioningUpdates',
      '-allowProvisioningDeviceRegistration',
      'build',
    ],
    {
      SKIP_BUNDLING: '1',
    },
  );
}

run('expo', ['run:ios', ...args]);
