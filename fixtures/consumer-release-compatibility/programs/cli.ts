import assert from 'node:assert/strict';

import { runCli } from '@zmdb/cli';

const stdout: string[] = [];
const stderr: string[] = [];
const environment = {
  stdout: (text: string) => {
    stdout.push(text);
  },
  stderr: (text: string) => {
    stderr.push(text);
  },
};
assert.equal(await runCli(['--help'], environment), 0);
assert.match(stdout.join(''), /zmdb/);
assert.equal(await runCli(['not-a-release-command'], environment), 2);
assert.match(stderr.join(''), /not-a-release-command/);
