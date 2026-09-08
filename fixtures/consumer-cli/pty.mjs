import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { stripVTControlCharacters } from 'node:util';

import { cleanEnvironment, trackChild } from './registry.mjs';
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;
export function pty(argv, { cwd, env = {} }) {
  const child = spawn(
    '/usr/bin/script',
    ['--quiet', '--return', '--flush', '--echo', 'never', '--command', argv.map(quote).join(' '), '/dev/null'],
    { cwd, env: { ...cleanEnvironment(), ...env }, detached: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  trackChild(child);
  let output = '',
    stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => {
    output += text;
  });
  child.stderr.on('data', text => {
    stderr += text;
  });
  const exited = new Promise((accept, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => accept({ code, signal, output, stderr }));
  });
  return {
    child,
    exited,
    read: () => stripVTControlCharacters(output),
    write: text => child.stdin.write(text),
    eof: () => child.stdin.write('\x04'),
    signal: signal => process.kill(-child.pid, signal),
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        process.kill(-child.pid, 'SIGTERM');
      }
      const result = await exited;
      assert.equal(result.signal, null);
      return result;
    },
  };
}
