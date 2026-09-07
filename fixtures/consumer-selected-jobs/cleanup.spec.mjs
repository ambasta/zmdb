import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { test } from 'node:test';

import { qualifySelectedJobs } from './qualify.mjs';

const input = process.env.ZMDB_SELECTED_JOBS_TARBALLS;
assert(input !== undefined, 'ZMDB_SELECTED_JOBS_TARBALLS must name real publish-manifest tarball records');
const tarballs = JSON.parse(await readFile(input, 'utf8'));

async function refusesConnection(port) {
  const socket = connect({ host: '127.0.0.1', port });
  const result = await new Promise((done, reject) => {
    socket.once('connect', () => done('connected'));
    socket.once('error', error => done(error.code));
    socket.setTimeout(1000, () => reject(new Error(`cleanup port ${port} timed out`)));
  }).finally(() => socket.destroy());
  assert.equal(result, 'ECONNREFUSED', `cleanup port ${port} still accepts connections`);
}

for (const failureMode of ['consumer', 'timeout']) {
  await test(`[RF757-T02] ${failureMode} failure cleans the installed consumers, registry, cache and PostgreSQL`, async () => {
    const report = await qualifySelectedJobs({ tarballs, failureMode });
    assert.equal(report.cleaned, true);
    assert.equal(report.failures.length, 1);
    assert.deepEqual(
      report.consumers.map(entry => entry.lane),
      ['default', 'sqlite'],
      report.failures.join('\n'),
    );
    assert.match(report.failures[0], /process\.exit\(17\)|setInterval/);
    assert.equal(
      report.commands.some(entry => entry.command === process.execPath && entry.code !== 0),
      true,
    );
    await assert.rejects(access(report.directory), { code: 'ENOENT' });
    assert.throws(() => process.kill(report.postgres.pid, 0), { code: 'ESRCH' });
    await refusesConnection(report.postgres.port);
    await refusesConnection(Number(new URL(report.registryOrigin).port));
  });
}
