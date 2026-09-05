#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

if (process.version.startsWith('v22.') && !process.execArgv.includes('--js-explicit-resource-management')) {
  try {
    execFileSync(
      process.execPath,
      ['--js-explicit-resource-management', ...process.execArgv, ...process.argv.slice(1)],
      { stdio: 'inherit' },
    );
    process.exit(0);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
      process.exit(err.status);
    } else {
      process.exit(1);
    }
  }
}

const { runCli } = await import('./index.js');

process.exitCode = await runCli(process.argv.slice(2));
