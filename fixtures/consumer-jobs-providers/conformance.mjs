import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { createApplication } from '@zmdb/app';
import { createQueue, createScheduler, createWorker, jobsExtension } from '@zmdb/jobs';

import { ClusterTasks, JobsApplication } from './dist/tasks.js';

const START = Date.parse('2026-09-07T00:00:00.000Z');

export class ManualClock {
  current = START;
  pending = new Set();

  now() {
    return this.current;
  }

  sleep(duration, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const pending = { deadline: this.current + duration, resolve, signal, reject };
      this.pending.add(pending);
      signal.addEventListener(
        'abort',
        () => {
          this.pending.delete(pending);
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }

  advance(duration) {
    this.current += duration;
    for (const pending of this.pending) {
      if (pending.deadline > this.current) continue;
      this.pending.delete(pending);
      pending.resolve();
    }
  }
}

function job(id, changes = {}) {
  return {
    id,
    name: 'deliver',
    payload: JSON.stringify({ id: 17 }),
    enqueuedAt: new Date(START),
    availableAt: new Date(START),
    ...changes,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function workerOptions(store, clock, handlers, changes = {}) {
  return {
    store,
    clock,
    handlers,
    concurrency: 2,
    graceMs: 100,
    leaseMs: 2000,
    timeoutMs: 1000,
    retries: { attempts: 2, backoff: { kind: 'fixed', delayMs: 10 } },
    onDead: () => undefined,
    onHandlerError: () => undefined,
    ...changes,
  };
}

function handler(execute) {
  return {
    name: 'deliver',
    validate(value) {
      if (value === null || typeof value !== 'object' || typeof value.id !== 'number')
        throw new TypeError('numeric id required');
      return value;
    },
    handle: execute,
  };
}

export async function qualifyProvider(provider) {
  async function caseWithStore(name, execute, migrate = true) {
    await test(`${provider.name}: ${name}`, { timeout: 15_000 }, async () => {
      const context = await provider.create();
      try {
        if (migrate) for (const migration of provider.migrations) await context.exec(migration.up);
        await execute(context);
      } finally {
        await context.close();
      }
    });
  }

  await caseWithStore(
    'fresh migrations are explicit and reversible',
    async context => {
      assert.deepEqual(
        provider.migrations.map(({ version, name }) => [version, name]),
        [
          [20260906000100, 'jobs_queue'],
          [20260906000200, 'jobs_schedule_lease'],
        ],
      );
      await assert.rejects(
        context.store.candidates({ now: new Date(START), limit: 1 }),
        /zmdb_job|does not exist|no such table/i,
      );
      await assert.rejects(
        context.transaction(async transaction => {
          await transaction.query(provider.migrations[0].up);
          await transaction.query(provider.migrations[0].up);
        }),
        /already exists/i,
      );
      await assert.rejects(context.query('SELECT * FROM zmdb_job'), /does not exist|no such table/i);
      for (const migration of provider.migrations) await context.exec(migration.up);
      for (const table of ['zmdb_job', 'zmdb_job_done', 'zmdb_job_lease']) {
        assert.equal(Number((await context.query(`SELECT COUNT(*) AS count FROM ${table}`))[0].count), 0);
      }
      const metadata = await context.schemaMetadata();
      const names = {
        zmdb_job: [
          'id',
          'name',
          'payload',
          'status',
          'attempts',
          'enqueued_at',
          'dedupe_key',
          'lease_owner',
          'lease_until',
          'last_error',
          'dead_reason',
          'dead_detail',
          'dead_at',
        ],
        zmdb_job_done: ['key', 'completed_at'],
        zmdb_job_lease: ['key', 'holder', 'expires_at'],
      };
      const required = {
        zmdb_job: ['name', 'payload', 'status', 'attempts', 'enqueued_at', 'lease_owner', 'lease_until'],
        zmdb_job_done: ['completed_at'],
        zmdb_job_lease: ['holder', 'expires_at'],
      };
      for (const [table, expected] of Object.entries(names)) {
        assert.deepEqual(
          metadata.columns[table].map(column => column.name),
          expected,
        );
        for (const name of required[table])
          assert.equal(
            metadata.columns[table].find(column => column.name === name).nullable,
            false,
            `${table}.${name} must refuse NULL`,
          );
      }
      assert.deepEqual(metadata.indexes.map(index => index.name).toSorted(), [
        'zmdb_job_dead',
        'zmdb_job_lease_expiry',
        'zmdb_job_pending',
        'zmdb_job_schedule_expiry',
      ]);
      for (const [name, columns, predicate] of [
        ['zmdb_job_pending', ['status', 'lease_until', 'enqueued_at'], 'pending'],
        ['zmdb_job_lease_expiry', ['lease_until'], 'pending'],
        ['zmdb_job_dead', ['dead_at'], 'dead'],
        ['zmdb_job_schedule_expiry', ['expires_at'], undefined],
      ]) {
        const index = metadata.indexes.find(candidate => candidate.name === name);
        assert.deepEqual(index.columns, columns);
        assert.equal(index.predicate, predicate);
      }
      await context.exec(
        "INSERT INTO zmdb_job(id,name,payload,enqueued_at) VALUES ('defaults','deliver','{}','2026-09-07T00:00:00.000Z')",
      );
      const defaults = (
        await context.query(
          "SELECT status,attempts,lease_owner,lease_until,last_error,dead_reason,dead_detail,dead_at FROM zmdb_job WHERE id='defaults'",
        )
      )[0];
      assert.deepEqual(
        { ...defaults, lease_until: new Date(defaults.lease_until).toISOString() },
        {
          status: 'pending',
          attempts: 0,
          lease_owner: '',
          lease_until: '1970-01-01T00:00:00.000Z',
          last_error: null,
          dead_reason: null,
          dead_detail: null,
          dead_at: null,
        },
      );
      for (const assignment of [
        "status='unexpected'",
        'attempts=-1',
        "dead_reason='unexpected'",
        'name=NULL',
        'payload=NULL',
        'enqueued_at=NULL',
        'lease_owner=NULL',
        'lease_until=NULL',
      ]) {
        await assert.rejects(
          context.exec(`UPDATE zmdb_job SET ${assignment} WHERE id='defaults'`),
          /constraint|not.null|check/i,
        );
      }
      await assert.rejects(
        context.exec(
          "INSERT INTO zmdb_job(id,name,payload,enqueued_at) VALUES ('defaults','duplicate','{}','2026-09-07T00:00:00.000Z')",
        ),
        /unique|duplicate/i,
      );
      await assert.rejects(
        context.exec(
          "INSERT INTO zmdb_job_lease(key,holder,expires_at) VALUES ('invalid','','2026-09-07T00:00:00.000Z')",
        ),
        /constraint|check/i,
      );
      for (const migration of [...provider.migrations].toReversed()) await context.exec(migration.down);
      await assert.rejects(context.query('SELECT * FROM zmdb_job'), /does not exist|no such table/i);
      await context.exec('CREATE TABLE zmdb_job (obsolete_id integer)');
      await assert.rejects(context.store.enqueue(job('obsolete')), /column|no such|does not exist/i);
      assert.deepEqual(await context.query('SELECT obsolete_id FROM zmdb_job'), []);
    },
    false,
  );

  await caseWithStore(
    'validates the common input domains before touching an absent schema',
    async context => {
      for (const bad of ['', '\u0000', '\ud800']) {
        await assert.rejects(context.store.enqueue(job(bad)), TypeError);
        await assert.rejects(context.store.completed(bad), TypeError);
        await assert.rejects(context.store.acquire('task', bad, 1), TypeError);
      }
      for (const bad of [
        new Date(NaN),
        new Date('0000-12-31T23:59:59.999Z'),
        new Date('+010000-01-01T00:00:00.000Z'),
      ]) {
        await assert.rejects(context.store.enqueue(job('bad', { enqueuedAt: bad })), RangeError);
        await assert.rejects(context.store.replay('bad', bad), RangeError);
      }
      for (const bad of [0, -1, 1.5, Infinity, NaN, 2147483648]) {
        await assert.rejects(context.store.candidates({ now: new Date(START), limit: bad }), RangeError);
        await assert.rejects(context.store.listDead({ limit: bad }), RangeError);
        await assert.rejects(context.store.acquire('task', 'owner', bad), RangeError);
      }
      for (const attempts of [-1, 1.5, Infinity, 2147483648]) {
        await assert.rejects(
          context.store.settle({
            kind: 'retry',
            jobId: 'bad',
            holder: 'owner',
            attempts,
            availableAt: new Date(START),
            detail: 'bad',
          }),
          RangeError,
        );
      }
      await assert.rejects(context.store.listDead({ limit: 1, reason: 'not-supported' }), TypeError);
      await assert.rejects(context.store.settle({ kind: 'not-supported', jobId: 'bad', holder: 'owner' }), TypeError);
    },
    false,
  );

  await caseWithStore('uses binary ties and refuses an unheld future claim', async context => {
    for (const id of ['é', 'z', 'A', '😀']) await context.store.enqueue(job(id));
    await context.store.enqueue(job('future', { availableAt: new Date(START + 100) }));
    assert.deepEqual(
      (await context.store.candidates({ now: new Date(START), limit: 2 })).map(row => row.id),
      ['A', 'z'],
    );
    assert.deepEqual(
      await context.store.claim({
        ids: ['future'],
        holder: 'owner',
        now: new Date(START),
        leaseUntil: new Date(START + 50),
      }),
      [],
    );
    for (const id of ['é', 'z', 'A', '😀']) {
      await context.store.claim({ ids: [id], holder: 'owner', now: new Date(START), leaseUntil: new Date(START + 50) });
      assert.equal(
        await context.store.settle({
          kind: 'dead',
          jobId: id,
          holder: 'owner',
          attempts: 1,
          reason: 'unknown-name',
          detail: 'missing',
          deadAt: new Date(START),
        }),
        true,
      );
    }
    assert.deepEqual(
      (await context.store.listDead({ limit: 4 })).map(row => row.jobId),
      ['A', 'z', 'é', '😀'],
    );
    for (const [id, date] of [
      ['minimum', '0001-01-01T00:00:00.000Z'],
      ['maximum', '9999-12-31T23:59:59.999Z'],
    ]) {
      await context.store.enqueue(job(id, { enqueuedAt: new Date(date), availableAt: new Date(date) }));
    }
    const boundaries = await context.store.candidates({ now: new Date('9999-12-31T23:59:59.999Z'), limit: 2147483647 });
    assert.equal(boundaries[0].id, 'minimum');
    assert.equal(boundaries.at(-1).enqueuedAt.toISOString(), '9999-12-31T23:59:59.999Z');
  });

  await caseWithStore('fences every settlement arm and refuses counter overflow atomically', async context => {
    await context.store.enqueue(job('fenced'));
    await context.store.claim({
      ids: ['fenced'],
      holder: 'owner',
      now: new Date(START),
      leaseUntil: new Date(START + 1),
    });
    const before = await context.query('SELECT * FROM zmdb_job');
    const variants = [
      { kind: 'done', idempotencyKey: 'fenced', completedAt: new Date(START + 2) },
      { kind: 'retry', attempts: 1, availableAt: new Date(START), detail: 'retry' },
      { kind: 'dead', attempts: 1, reason: 'invalid-payload', detail: 'dead', deadAt: new Date(START) },
      { kind: 'release', availableAt: new Date(START) },
    ];
    for (const variant of variants) {
      for (const [jobId, holder] of [
        ['fenced', 'wrong'],
        ['missing', 'owner'],
      ]) {
        assert.equal(await context.store.settle({ ...variant, jobId, holder }), false);
      }
    }
    assert.deepEqual(await context.query('SELECT * FROM zmdb_job'), before);
    assert.equal(await context.store.completed('fenced'), false);
    assert.equal(await context.store.replay('fenced', new Date(START)), false);
    await context.exec('UPDATE zmdb_job SET attempts=2147483647');
    await assert.rejects(context.store.settle({ ...variants[0], jobId: 'fenced', holder: 'owner' }));
    assert.deepEqual(await context.query('SELECT status, attempts, lease_owner FROM zmdb_job'), [
      { status: 'pending', attempts: 2147483647, lease_owner: 'owner' },
    ]);
    assert.equal(await context.store.completed('fenced'), false);
    await context.exec('UPDATE zmdb_job SET attempts=0');
    assert.equal(
      await context.store.settle({ ...variants[0], jobId: 'fenced', holder: 'owner' }),
      true,
      'expiry alone does not change the holder',
    );
    for (const variant of variants)
      assert.equal(await context.store.settle({ ...variant, jobId: 'fenced', holder: 'owner' }), false);
  });

  await caseWithStore('enqueue preserves delay and dedupe identity across restart', async context => {
    const clock = new ManualClock();
    const queue = createQueue({ store: context.store, clock });
    const identifiers = await Promise.all([
      queue.enqueue('deliver', { id: 17 }, { delayMs: 50, dedupeKey: "request:'1" }),
      queue.enqueue('deliver', { id: 17 }, { delayMs: 50, dedupeKey: "request:'1" }),
    ]);
    assert.equal(identifiers[0], identifiers[1]);
    assert.equal(Number((await context.query('SELECT COUNT(*) AS count FROM zmdb_job'))[0].count), 1);
    assert.deepEqual(await context.store.candidates({ now: new Date(START + 49), limit: 10 }), []);
    const reopened = await context.reopen();
    const candidates = await reopened.candidates({ now: new Date(START + 50), limit: 10 });
    assert.deepEqual(
      candidates.map(candidate => [candidate.id, candidate.name, candidate.enqueuedAt.toISOString()]),
      [[identifiers[0], 'deliver', new Date(START).toISOString()]],
    );
    await assert.rejects(reopened.enqueue(job(identifiers[0], { dedupeKey: 'different' })));
    assert.equal(Number((await context.query('SELECT COUNT(*) AS count FROM zmdb_job'))[0].count), 1);
  });

  await caseWithStore('transactional enqueue commits or rolls back with application data', async context => {
    await context.exec('CREATE TABLE application_effect (id integer PRIMARY KEY)');
    const queue = createQueue({ store: context.store, clock: new ManualClock() });
    await context.transaction(async transaction => {
      await transaction.query('INSERT INTO application_effect (id) VALUES (1)');
      await queue.enqueueInTransaction(transaction.enqueuer, 'deliver', { id: 1 });
    });
    await assert.rejects(
      context.transaction(async transaction => {
        await transaction.query('INSERT INTO application_effect (id) VALUES (2)');
        await queue.enqueueInTransaction(transaction.enqueuer, 'deliver', { id: 2 });
        throw new Error('caller rollback');
      }),
      /caller rollback/,
    );
    assert.deepEqual(await context.query('SELECT id FROM application_effect ORDER BY id'), [{ id: 1 }]);
    assert.deepEqual(
      (await context.query('SELECT payload FROM zmdb_job')).map(row => JSON.parse(row.payload)),
      [{ id: 1 }],
    );
  });

  await caseWithStore('concurrent claim and stale settlement preserve one holder', async context => {
    await context.store.enqueue(job('first'));
    await context.store.enqueue(job('second'));
    const other = await context.additional();
    const input = { ids: ['first', 'second'], now: new Date(START), leaseUntil: new Date(START + 1000) };
    const [first, second] = await Promise.all([
      context.store.claim({ ...input, holder: 'alpha' }),
      other.claim({ ...input, holder: 'beta' }),
    ]);
    assert.equal(first.length + second.length, 2);
    assert.equal(new Set([...first, ...second].map(row => row.id)).size, 2);
    for (const row of first) assert.equal(row.holder, 'alpha');
    for (const row of second) assert.equal(row.holder, 'beta');
    assert.deepEqual(await other.claim({ ...input, holder: 'gamma' }), []);
    const reclaimed = await other.claim({
      ...input,
      holder: 'gamma',
      now: new Date(START + 1001),
      leaseUntil: new Date(START + 2000),
    });
    assert.equal(reclaimed.length, 2);
    for (const id of ['first', 'second']) {
      assert.equal(
        await context.store.settle({
          kind: 'done',
          jobId: id,
          holder: 'alpha',
          idempotencyKey: id,
          completedAt: new Date(START + 1002),
        }),
        false,
      );
      assert.equal(await other.completed(id), false);
      assert.equal(
        await other.settle({
          kind: 'done',
          jobId: id,
          holder: 'gamma',
          idempotencyKey: id,
          completedAt: new Date(START + 1002),
        }),
        true,
      );
      assert.equal(await other.completed(id), true);
    }
    assert.deepEqual(await other.claim({ ...input, ids: [], holder: 'empty' }), []);
    assert.deepEqual(
      await other.claim({
        ...input,
        holder: 'finished',
        now: new Date(START + 3000),
        leaseUntil: new Date(START + 4000),
      }),
      [],
    );
  });

  await caseWithStore('completion marker and terminal state commit atomically', async context => {
    await context.store.enqueue(job('atomic'));
    await context.store.claim({
      ids: ['atomic'],
      holder: 'owner',
      now: new Date(START),
      leaseUntil: new Date(START + 1000),
    });
    const settlement = {
      kind: 'done',
      jobId: 'atomic',
      holder: 'owner',
      idempotencyKey: 'atomic',
      completedAt: new Date(START + 1),
    };
    await context.rejectCompletion();
    await assert.rejects(context.store.settle(settlement), /reject completion/i);
    assert.deepEqual(await context.query('SELECT status, lease_owner FROM zmdb_job'), [
      { status: 'pending', lease_owner: 'owner' },
    ]);
    assert.equal(Number((await context.query('SELECT COUNT(*) AS count FROM zmdb_job_done'))[0].count), 0);
    await context.allowCompletion();
    assert.equal(await context.store.settle(settlement), true);
    assert.deepEqual(await context.query('SELECT status FROM zmdb_job'), [{ status: 'done' }]);
    assert.equal(await context.store.completed('atomic'), true);
  });

  await caseWithStore('retry release dead and replay preserve the complete port state', async context => {
    await context.store.enqueue(job('state'));
    const claim = async () =>
      context.store.claim({
        ids: ['state', 'state'],
        holder: 'owner',
        now: new Date(START + 100),
        leaseUntil: new Date(START + 1000),
      });
    assert.equal((await claim()).length, 1);
    assert.equal(
      await context.store.settle({
        kind: 'retry',
        jobId: 'state',
        holder: 'owner',
        attempts: 1,
        availableAt: new Date(START + 50),
        detail: 'retry-detail',
      }),
      true,
    );
    assert.equal((await claim())[0].attempts, 1);
    assert.equal(
      await context.store.settle({
        kind: 'release',
        jobId: 'state',
        holder: 'owner',
        availableAt: new Date(START + 50),
      }),
      true,
    );
    assert.equal((await claim())[0].attempts, 1);
    assert.equal(
      await context.store.settle({
        kind: 'dead',
        jobId: 'state',
        holder: 'owner',
        attempts: 2,
        reason: 'attempts-exhausted',
        detail: 'last-failure',
        deadAt: new Date(START + 100),
      }),
      true,
    );
    assert.deepEqual(await context.store.listDead({ limit: 1, reason: 'attempts-exhausted' }), [
      {
        jobId: 'state',
        name: 'deliver',
        payload: '{"id":17}',
        attempts: 2,
        reason: 'attempts-exhausted',
        detail: 'last-failure',
        enqueuedAt: new Date(START),
        deadAt: new Date(START + 100),
      },
    ]);
    assert.equal(await context.store.replay('state', new Date(START + 100)), true);
    assert.equal(await context.store.replay('state', new Date(START + 100)), false);
    const replayed = await claim();
    assert.equal(replayed[0].attempts, 0);
    assert.equal(replayed[0].payload, '{"id":17}');
    await context.exec(
      "INSERT INTO zmdb_job_done (key, completed_at) VALUES ('already-completed', '2026-01-01T00:00:00.000Z')",
    );
    assert.equal(
      await context.store.settle({
        kind: 'done',
        jobId: 'state',
        holder: 'owner',
        idempotencyKey: 'already-completed',
        completedAt: new Date(START + 100),
      }),
      true,
    );
    assert.equal(
      new Date((await context.query('SELECT completed_at FROM zmdb_job_done'))[0].completed_at).toISOString(),
      '2026-01-01T00:00:00.000Z',
    );
    assert.deepEqual(await context.query('SELECT attempts, status FROM zmdb_job'), [{ attempts: 1, status: 'done' }]);
    for (const invalid of [0, -1, Infinity, 2147483648])
      await assert.rejects(context.store.candidates({ now: new Date(START), limit: invalid }), RangeError);
    await assert.rejects(
      context.store.enqueue(job('date', { availableAt: new Date('10000-01-01T00:00:00.000Z') })),
      RangeError,
    );
    await assert.rejects(context.store.enqueue(job('nul', { payload: '\u0000' })), TypeError);
  });

  await caseWithStore('workers validate retry dead-letter and replay through domain ports', async context => {
    const clock = new ManualClock();
    const seen = [];
    const errors = [];
    const dead = [];
    let failing = true;
    const worker = createWorker(
      workerOptions(
        context.store,
        clock,
        [
          handler(async payload => {
            if (payload.id === 2 && failing) throw new Error('delivery failed');
            seen.push(payload.id);
          }),
        ],
        {
          concurrency: 4,
          onDead: item => {
            dead.push(item);
          },
          onHandlerError: (_context, error) => {
            errors.push(error);
          },
        },
      ),
    );
    try {
      const queue = createQueue({ store: context.store, clock });
      await queue.enqueue('deliver', { id: 1 }, { dedupeKey: 'complete-once' });
      await queue.enqueue('deliver', { id: 2 });
      await context.store.enqueue(job('invalid', { payload: '{"id":"wrong"}' }));
      await context.store.enqueue(job('unknown', { name: 'not-registered' }));
      const first = await worker.runOnce();
      assert.deepEqual(first, { claimed: 4, done: 1, retried: 2, dead: 1, skipped: 0 });
      assert.deepEqual(seen, [1]);
      clock.advance(20);
      const second = await worker.runOnce();
      assert.deepEqual(second, { claimed: 2, done: 0, retried: 0, dead: 2, skipped: 0 });
      assert.equal(dead.length, 3);
      const listed = await worker.listDead({ limit: 10 });
      assert.deepEqual(listed.map(row => row.reason).toSorted(), [
        'attempts-exhausted',
        'invalid-payload',
        'unknown-name',
      ]);
      assert.equal((await worker.listDead({ limit: 10, reason: 'unknown-name' })).length, 1);
      const failed = listed.find(row => row.reason === 'attempts-exhausted');
      assert.equal(failed.attempts, 2);
      assert.equal(failed.detail, 'delivery failed');
      failing = false;
      assert.equal(await worker.replay(failed.jobId), true);
      assert.equal(await worker.replay('missing'), false);
      assert.equal((await worker.runOnce()).done, 1);
      assert.deepEqual(seen, [1, 2]);
      const duplicate = await queue.enqueue('deliver', { id: 999 }, { dedupeKey: 'complete-once' });
      assert.equal(typeof duplicate, 'string');
      assert.equal((await worker.runOnce()).claimed, 0);
      assert.deepEqual(seen, [1, 2]);
    } finally {
      await worker.onShutdown({ graceMs: 0 });
    }
  });

  await caseWithStore('two workers execute disjoint claims within concurrency bounds', async context => {
    const clock = new ManualClock();
    const queue = createQueue({ store: context.store, clock });
    for (const id of [1, 2, 3, 4]) await queue.enqueue('deliver', { id });
    const other = await context.additional();
    const released = deferred();
    const firstEntered = deferred();
    const secondEntered = deferred();
    const firstSeen = [];
    const secondSeen = [];
    const first = createWorker(
      workerOptions(context.store, clock, [
        handler(async payload => {
          firstSeen.push(payload.id);
          if (firstSeen.length === 2) firstEntered.resolve();
          await released.promise;
        }),
      ]),
    );
    const second = createWorker(
      workerOptions(other, clock, [
        handler(async payload => {
          secondSeen.push(payload.id);
          if (secondSeen.length === 2) secondEntered.resolve();
          await released.promise;
        }),
      ]),
    );
    try {
      const firstPass = first.runOnce();
      await firstEntered.promise;
      const secondPass = second.runOnce();
      await secondEntered.promise;
      assert.equal(firstSeen.filter(id => secondSeen.includes(id)).length, 0);
      assert.deepEqual([...firstSeen, ...secondSeen].toSorted(), [1, 2, 3, 4]);
      released.resolve();
      for (const report of await Promise.all([firstPass, secondPass])) assert.equal(report.done, 2);
    } finally {
      released.resolve();
      await Promise.all([first.onShutdown({ graceMs: 0 }), second.onShutdown({ graceMs: 0 })]);
    }
  });

  await caseWithStore('renewable leases admit one scheduler and reject wrong ownership', async context => {
    const other = await context.additional();
    assert.equal(await context.store.acquire('direct', 'one', 1000), true);
    assert.equal(await other.acquire('direct', 'two', 1000), false);
    assert.equal(await other.renew('direct', 'two', 1000), false);
    await other.release('direct', 'two');
    assert.equal(await other.acquire('direct', 'two', 1000), false);
    assert.equal(await context.store.renew('direct', 'one', 1000), true);
    await context.store.release('direct', 'one');
    assert.equal(await other.acquire('direct', 'two', 1000), true);
    assert.equal(await context.store.acquire('expiry', 'old', 10), true);
    await delay(30);
    assert.equal(await context.store.renew('expiry', 'old', 1000), false);
    assert.equal(await other.acquire('expiry', 'new', 1000), true);
    for (const invalid of [0, -1, Infinity, NaN]) {
      await assert.rejects(context.store.acquire('bad', 'one', invalid), /ttl|positive|finite/i);
    }
    const clock = new ManualClock();
    const entered = deferred();
    const release = deferred();
    const runs = [];
    const skipped = [];
    const options = {
      clock,
      leaseMs: 2000,
      graceMs: 100,
      onTaskError: (_name, _instant, error) => {
        throw error;
      },
      onSkipped: value => {
        skipped.push(value);
      },
    };
    const first = createScheduler({
      ...options,
      leases: context.store,
      tasks: [
        new ClusterTasks(async () => {
          runs.push('first');
          entered.resolve();
          await release.promise;
        }),
      ],
    });
    const second = createScheduler({
      ...options,
      leases: other,
      tasks: [
        new ClusterTasks(async () => {
          runs.push('second');
        }),
      ],
    });
    clock.advance(10);
    const firstRun = first.tick(clock.now());
    try {
      await entered.promise;
      await second.tick(clock.now());
      assert.deepEqual(runs, ['first']);
      assert(skipped.some(item => item.reason === 'lease-not-held'));
    } finally {
      release.resolve();
      await firstRun;
      await Promise.all([first.onShutdown({ graceMs: 0 }), second.onShutdown({ graceMs: 0 })]);
    }
  });

  await caseWithStore('resource shutdown preserves borrowed database connections', async context => {
    const clock = new ManualClock();
    const delivered = deferred();
    const effects = [];
    const worker = createWorker(
      workerOptions(context.store, clock, [
        handler(async payload => {
          effects.push(payload.id);
          delivered.resolve();
        }),
      ]),
    );
    await createQueue({ store: context.store, clock }).enqueue('deliver', { id: 51 });
    const application = createApplication(JobsApplication, {
      graceMs: 100,
      extensions: [jobsExtension({ workers: [worker], stores: [context.store, context.store] })],
    });
    try {
      await application.init();
      await delivered.promise;
    } finally {
      await application[Symbol.asyncDispose]();
      await application[Symbol.asyncDispose]();
    }
    assert.deepEqual(effects, [51]);
    assert.deepEqual(await context.query('SELECT 7 AS survived'), [{ survived: 7 }]);
    await assert.rejects(context.store.candidates({ now: new Date(START), limit: 1 }), /closed/i);
    await context.store.close();
  });

  await caseWithStore(
    'real lease replacement aborts the observed task signal and disables later fires',
    async context => {
      const clock = new ManualClock();
      const entered = deferred();
      const errors = [];
      let signal;
      let calls = 0;
      const scheduler = createScheduler({
        clock,
        leases: context.store,
        leaseMs: 900,
        graceMs: 100,
        onTaskError: (_name, _time, error) => {
          errors.push(error);
        },
        onSkipped: () => undefined,
        tasks: [
          new ClusterTasks(async activeSignal => {
            calls += 1;
            signal = activeSignal;
            entered.resolve();
            await new Promise(resolve => activeSignal.addEventListener('abort', resolve, { once: true }));
          }),
        ],
      });
      clock.advance(10);
      const running = scheduler.tick(clock.now());
      try {
        await entered.promise;
        assert(signal instanceof AbortSignal);
        assert.equal(signal.aborted, false);
        await context.exec("UPDATE zmdb_job_lease SET holder='replacement'");
        clock.advance(301);
        await running;
        assert.equal(signal.aborted, true);
        assert.equal(errors.length, 1);
        assert.match(errors[0].message, /renewal.*refused/);
        clock.advance(20);
        await scheduler.tick(clock.now());
        assert.equal(calls, 1);
        await scheduler.onShutdown({ graceMs: 0 });
        assert.deepEqual(await context.query('SELECT holder FROM zmdb_job_lease'), [{ holder: 'replacement' }]);
      } finally {
        await scheduler.onShutdown({ graceMs: 0 });
      }
    },
  );
}
