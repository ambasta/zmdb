import assert from 'node:assert/strict';

const jobs = await import('@zmdb/jobs');
const schedule = await import('@zmdb/jobs/schedule');

assert.deepEqual(
  Object.keys(jobs).toSorted(),
  ['Cron', 'Interval', 'createQueue', 'createScheduler', 'createWorker', 'jobsExtension', 'schedulesOf'].toSorted(),
);
for (const name of ['Cron', 'Interval', 'createScheduler', 'schedulesOf']) {
  assert.equal(jobs[name], schedule[name]);
}
await assert.rejects(import('@zmdb/jobs/memory'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
await assert.rejects(import('@zmdb/repository/jobs'), { code: 'ERR_MODULE_NOT_FOUND' });
for (const name of ['@zmdb/jobs-sqlite', '@zmdb/jobs-postgres', '@zmdb/sqlite', '@zmdb/postgres', 'pg']) {
  await assert.rejects(import(name), { code: 'ERR_MODULE_NOT_FOUND' });
}
assert.throws(() => jobs.createQueue({ clock: { now: Date.now } }), /store/i);
process.stdout.write('portable public exports, identity and provider refusal passed\n');
