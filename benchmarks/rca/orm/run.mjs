import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { Session } from 'node:inspector/promises';
import { createRequire } from 'node:module';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { BaseRepository, createLoaderScope } from '@zmdb/orm';
import { postgres, postgresDriver } from '@zmdb/postgres';
import { schemaFromIR } from '@zmdb/schema/ir';
import { createQueryCompiler } from '@zmdb/sql';
import { and, eq, gte, inArray, lte, relations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

const { values } = parseArgs({
  options: {
    mode: { type: 'string', default: 'smoke' },
    schema: { type: 'string' },
    out: { type: 'string' },
    variants: { type: 'string', default: 'pg,drizzle,kysely,zmdb-builder,repository,deferred,drizzle-relational' },
    workloads: { type: 'string', default: 'lookup,nested' },
    concurrency: { type: 'string', default: '1,48' },
    rounds: { type: 'string', default: '3' },
    duration: { type: 'string', default: '4000' },
    warmup: { type: 'string', default: '1000' },
    pool: { type: 'string', default: '12' },
    trace: { type: 'boolean', default: false },
    profile: { type: 'string' },
  },
});
if (!values.schema || !values.out) throw new Error('requires --schema <generated-schema.json> --out <result.json>');
if (!process.env.PGURL) throw new Error('PGURL must name the dedicated benchmark database');
const variantNames = values.variants.split(',');
const workloads = values.workloads.split(',');
const concurrencies = values.concurrency.split(',').map(Number);
for (const variant of variantNames)
  if (!['pg', 'drizzle', 'kysely', 'zmdb-builder', 'repository', 'deferred', 'drizzle-relational'].includes(variant))
    throw new Error(`unknown variant ${variant}`);
for (const workload of workloads)
  if (!['lookup', 'nested'].includes(workload)) throw new Error(`unknown workload ${workload}`);
const duration = Number(values.duration),
  warmup = Number(values.warmup),
  rounds = Number(values.rounds);
const poolSize = Number(values.pool);
if ([duration, warmup, rounds, poolSize, ...concurrencies].some(value => !Number.isFinite(value) || value < 1))
  throw new Error('numeric options must be positive');
const generated = JSON.parse(await readFile(values.schema, 'utf8'));
const schemas = Object.fromEntries(Object.entries(generated.schemas).map(([name, ir]) => [name, schemaFromIR(ir)]));
const pool = new Pool({ connectionString: process.env.PGURL, max: poolSize, application_name: 'zmdb-orm-rca' });
const context = new AsyncLocalStorage();
const captured = [];
let capture = false;
function query(statement, parameters) {
  const textValue = typeof statement === 'string' ? statement : statement.text;
  const params = parameters ?? statement.values ?? [];
  if (capture) captured.push({ text: textValue, parameters: [...params] });
  if (!values.trace || !context.getStore()) return pool.query(statement, parameters);
  return measuredQuery(statement, parameters);
}
async function measuredQuery(statement, parameters) {
  const sample = context.getStore();
  const start = performance.now();
  const client = await pool.connect();
  const acquired = performance.now();
  sample.poolWaitMs += acquired - start;
  sample.maxWaiting = Math.max(sample.maxWaiting, pool.waitingCount);
  try {
    return await client.query(statement, parameters);
  } finally {
    sample.roundtripMs += performance.now() - acquired;
    sample.queries++;
    client.release();
  }
}
const qc = createQueryCompiler(postgres);
const ddb = drizzle(pool);
const kdb = new Kysely({ dialect: new PostgresDialect({ pool }) });
const modelNames = ['RcaUser', 'RcaPost', 'RcaComment'];
const tables = Object.fromEntries(
  modelNames.map(name => {
    const ir = generated.schemas[name];
    const columns = Object.fromEntries(
      ir.columns.map(column => {
        if (column.sql !== 'integer' && column.sql !== 'text') throw new Error(`unhandled model type ${column.sql}`);
        const builder = column.sql === 'integer' ? integer(column.physicalName) : text(column.physicalName);
        return [column.name, column.primaryKey ? builder.primaryKey() : builder.notNull()];
      }),
    );
    return [name, pgTable(ir.physicalTable, columns)];
  }),
);
const modelByTable = Object.fromEntries(modelNames.map(name => [generated.schemas[name].table, name]));
const nativeRelations = Object.fromEntries(
  modelNames.map(model => [
    `${model}Relations`,
    relations(tables[model], ({ many, one }) => {
      const outgoing = generated.schemas[model].relations.map(relation => {
        assert.equal(relation.relation, 'oneToMany');
        return [relation.name, many(tables[modelByTable[relation.target]])];
      });
      const incoming = modelNames.flatMap(parent =>
        generated.schemas[parent].relations
          .filter(relation => modelByTable[relation.target] === model)
          .map(relation => {
            const keys = generated.schemas[parent].columns.filter(column => column.primaryKey);
            assert.equal(keys.length, 1);
            return [
              `parent${parent}`,
              one(tables[parent], {
                fields: [tables[model][relation.via]],
                references: [tables[parent][keys[0].name]],
              }),
            ];
          }),
      );
      return Object.fromEntries([...outgoing, ...incoming]);
    }),
  ]),
);
const relationalDb = drizzle({ client: { query }, schema: { ...tables, ...nativeRelations } });
class Users extends BaseRepository {
  static schema = schemas.RcaUser;
}
const repository = new Users(postgresDriver({ query }), postgres, { schemas: [schemas.RcaPost, schemas.RcaComment] });
function cpuSpan(bucket, run) {
  const sample = context.getStore();
  if (!sample) return run();
  const start = performance.now();
  try {
    return run();
  } finally {
    sample[bucket] += performance.now() - start;
  }
}
if (values.trace) {
  for (const [method, bucket] of [
    ['compileRead', 'compileMs'],
    ['populatePlan', 'metadataMs'],
    ['decodeRows', 'decodeMs'],
  ]) {
    const original = BaseRepository.prototype[method];
    if (typeof original !== 'function') throw new Error(`trace hook missing: ${method}`);
    BaseRepository.prototype[method] = function (...args) {
      return cpuSpan(bucket, () => original.apply(this, args));
    };
  }
}
const quoted = name => `"${name.replaceAll('"', '""')}"`;
const queryMetadata = Object.fromEntries(
  modelNames.map(model => {
    const ir = generated.schemas[model];
    const columns = Object.fromEntries(ir.columns.map(column => [column.name, column.physicalName]));
    const projection = ir.columns.map(column => ({ column: column.physicalName, alias: column.name }));
    const prefix = `SELECT ${projection.map(column => `${quoted(column.column)} AS ${quoted(column.alias)}`).join(', ')} FROM ${quoted(ir.physicalTable)} WHERE `;
    const placeholders = count => Array.from({ length: count }, (_, index) => `$${index + 1}`).join(', ');
    const raw =
      model === 'RcaUser'
        ? {
            id: `${prefix}${quoted(columns.id)} = $1 LIMIT 1`,
            range: `${prefix}${quoted(columns.tenantId)} = $1 AND ${quoted(columns.id)} >= $2 AND ${quoted(columns.id)} <= $3`,
          }
        : model === 'RcaPost'
          ? { userId: `${prefix}${quoted(columns.userId)} IN (${placeholders(25)})` }
          : { postId: `${prefix}${quoted(columns.postId)} IN (${placeholders(100)})` };
    return [
      model,
      {
        ir,
        columns,
        projection,
        raw,
        kyselyProjection: projection.map(column => `${column.column} as ${column.alias}`),
        drizzleSelection: Object.fromEntries(
          ir.columns.map(column => [column.name, sql`${tables[model][column.name]}`.as(column.name)]),
        ),
      },
    ];
  }),
);
function build(variant, model, kind, args) {
  const metadata = queryMetadata[model];
  // Raw pg is the prewritten-statement lower bound; builder compilation stays in the other lanes.
  if (variant === 'pg') return { text: metadata.raw[kind], parameters: args };
  return cpuSpan('compileMs', () => {
    const { ir, columns, projection } = metadata;
    const column = name => columns[name];
    if (variant === 'zmdb-builder') {
      let builder = qc.selectFrom(ir.physicalTable).select(projection);
      if (kind === 'id') builder = builder.where(column('id'), '=', args[0]).limit(1);
      else if (kind === 'range')
        builder = builder
          .where(column('tenantId'), '=', args[0])
          .andWhere(column('id'), '>=', args[1])
          .andWhere(column('id'), '<=', args[2]);
      else builder = builder.whereIn(column(kind), args);
      return builder.compile();
    }
    if (variant === 'kysely') {
      let builder = kdb.selectFrom(ir.physicalTable).select(metadata.kyselyProjection);
      if (kind === 'id') builder = builder.where(column('id'), '=', args[0]).limit(1);
      else if (kind === 'range')
        builder = builder
          .where(column('tenantId'), '=', args[0])
          .where(column('id'), '>=', args[1])
          .where(column('id'), '<=', args[2]);
      else builder = builder.where(column(kind), 'in', args);
      const result = builder.compile();
      return { text: result.sql, parameters: result.parameters };
    }
    const table = tables[model];
    let builder = ddb.select(metadata.drizzleSelection).from(table);
    if (kind === 'id') builder = builder.where(eq(table.id, args[0])).limit(1);
    else if (kind === 'range')
      builder = builder.where(and(eq(table.tenantId, args[0]), gte(table.id, args[1]), lte(table.id, args[2])));
    else builder = builder.where(inArray(table[kind], args));
    const result = builder.toSQL();
    return { text: result.sql, parameters: result.params };
  });
}
async function selected(variant, model, kind, args) {
  const compiled = build(variant, model, kind, args);
  return (await query(compiled.text, compiled.parameters)).rows;
}
function attach(users, posts, comments) {
  return cpuSpan('attachMs', () => {
    const commentsByPost = new Map();
    for (const comment of comments) {
      const group = commentsByPost.get(comment.postId) ?? [];
      group.push({ ...comment });
      commentsByPost.set(comment.postId, group);
    }
    const postsByUser = new Map();
    for (const post of posts) {
      const group = postsByUser.get(post.userId) ?? [];
      group.push({ ...post, comments: commentsByPost.get(post.id) ?? [] });
      postsByUser.set(post.userId, group);
    }
    return users.map(user => ({ ...user, posts: postsByUser.get(user.id) ?? [] }));
  });
}
async function operation(variant, workload, sequence) {
  const id = 1 + (sequence % 1000);
  if (workload === 'lookup') {
    return variant === 'repository' || variant === 'deferred'
      ? [await repository.findById(id)]
      : selected(variant, 'RcaUser', 'id', [id]);
  }
  const first = 1 + (sequence % 39) * 25;
  const where = { tenantId: 1, id: { gte: first, lte: first + 24 } };
  if (variant === 'drizzle-relational')
    return relationalDb.query.RcaUser.findMany({
      where: and(eq(tables.RcaUser.tenantId, 1), gte(tables.RcaUser.id, first), lte(tables.RcaUser.id, first + 24)),
      with: { posts: { with: { comments: true } } },
    });
  if (variant === 'repository') return repository.find(where, { populate: ['posts.comments'] });
  if (variant === 'deferred') {
    const roots = await repository.find(where);
    const scope = createLoaderScope();
    return Promise.all(roots.map(row => scope.populate(repository, row, ['posts.comments'])));
  }
  const users = await selected(variant, 'RcaUser', 'range', [1, first, first + 24]);
  const posts = await selected(
    variant,
    'RcaPost',
    'userId',
    users.map(row => row.id),
  );
  const comments = await selected(
    variant,
    'RcaComment',
    'postId',
    posts.map(row => row.id),
  );
  return attach(users, posts, comments);
}
function normalize(rows) {
  return rows
    .map(row => ({
      ...row,
      ...(row.posts ? { posts: normalize(row.posts) } : {}),
      ...(row.comments ? { comments: normalize(row.comments) } : {}),
    }))
    .toSorted((a, b) => a.id - b.id);
}
function quantile(sorted, q) {
  return sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)] ?? null;
}
function distribution(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  return {
    count: sorted.length,
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    p99: quantile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
  };
}
async function pass(variant, workload, concurrency, milliseconds, retain) {
  const startedAt = new Date().toISOString();
  let sequence = 0,
    checksum = 0;
  const samples = [];
  const cpuStart = process.cpuUsage();
  const start = performance.now(),
    until = start + milliseconds;
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  if (retain) eventLoop.enable();
  async function worker() {
    while (performance.now() < until) {
      const index = sequence++;
      const sample = values.trace
        ? {
            poolWaitMs: 0,
            roundtripMs: 0,
            compileMs: 0,
            metadataMs: 0,
            decodeMs: 0,
            attachMs: 0,
            maxWaiting: 0,
            queries: 0,
          }
        : null;
      const began = performance.now();
      const rows = values.trace
        ? await context.run(sample, () => operation(variant, workload, index))
        : await operation(variant, workload, index);
      const elapsedMs = performance.now() - began;
      checksum += rows.length;
      if (retain && !values.profile) {
        if (values.trace) {
          sample.elapsedMs = elapsedMs;
          sample.otherMs = Math.max(
            0,
            elapsedMs -
              sample.poolWaitMs -
              sample.roundtripMs -
              sample.compileMs -
              sample.metadataMs -
              sample.decodeMs -
              sample.attachMs,
          );
          samples.push(sample);
        } else samples.push(elapsedMs);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    eventLoop.disable();
  }
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuStart);
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    variant,
    workload,
    concurrency,
    operations: sequence,
    elapsedMs,
    operationsPerSecond: (sequence / elapsedMs) * 1000,
    cpuMs: {
      user: cpu.user / 1000,
      system: cpu.system / 1000,
      percentOfOneCpu: (cpu.user + cpu.system) / 10 / elapsedMs,
    },
    checksum,
    latencyMs: distribution(samples.map(sample => (typeof sample === 'number' ? sample : sample.elapsedMs))),
    eventLoopDelayMs: { p99: eventLoop.percentile(99) / 1e6, max: eventLoop.max / 1e6 },
    samples,
  };
}
async function stats() {
  return (
    await pool.query(
      `SELECT queryid, query, calls, total_plan_time, total_exec_time, rows, shared_blks_hit, shared_blks_read, shared_blk_read_time, shared_blk_write_time, temp_blk_read_time, temp_blk_write_time FROM pg_stat_statements WHERE query LIKE '%rca_orm_%' AND query NOT LIKE '%pg_stat_statements%' ORDER BY query`,
    )
  ).rows;
}
const require = createRequire(import.meta.url);
const versions = Object.fromEntries(
  ['pg', 'drizzle-orm', 'kysely'].map(name => {
    const entry = require.resolve(name);
    let directory = entry.slice(0, entry.lastIndexOf('/'));
    while (true) {
      try {
        const pkg = require(`${directory}/package.json`);
        if (pkg.name === name) return [name, pkg.version];
      } catch {}
      const parent = directory.slice(0, directory.lastIndexOf('/'));
      if (!parent || parent === directory) throw new Error(`version not found: ${name}`);
      directory = parent;
    }
  }),
);
const report = {
  startedAt: new Date().toISOString(),
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version,
  versions,
  mode: values.mode,
  trace: values.trace,
  recordsLatencySamples: !values.profile,
  command: process.argv,
  poolSize,
  workload: { userCount: 2000, postsPerUser: 4, commentsPerPost: 3, nestedUsers: 25 },
  methodology:
    'Direct SQL-builder comparison uses each library to compile statements, then one common pg Pool transport and one common manual assembler. Repository/deferred lanes use the real BaseRepository. The separately labeled drizzle-relational strategy executes native findMany with one lateral JSON aggregation statement and its own result mapper through the same pool. Same selected columns and bound predicates; unordered graph equality is checked outside timing. All statements use the unprepared unnamed extended protocol. Trace timings are instrumented and excluded from clean ranking; roundtrip includes driver/network/server. Other time includes JS attachment, uninstrumented native relational compilation and async scheduling, not pure CPU.',
  results: [],
};
try {
  report.postgres = (
    await pool.query("SELECT version() AS version, current_setting('shared_buffers') AS shared_buffers")
  ).rows[0];
  if (values.mode === 'seed') {
    for (const name of ['rca_orm_comments', 'rca_orm_posts', 'rca_orm_users'])
      await pool.query(`DROP TABLE IF EXISTS ${quoted(name)}`);
    for (const ddl of generated.ddl) if (ddl.trim()) await pool.query(ddl);
    await pool.query(
      `INSERT INTO rca_orm_users (id, tenant_id, name) SELECT n, CASE WHEN n <= 1000 THEN 1 ELSE 2 END, 'user-' || n FROM generate_series(1,2000) n`,
    );
    await pool.query(
      `INSERT INTO rca_orm_posts (id, user_id, title) SELECT n, ((n-1)/4)+1, 'post-' || n FROM generate_series(1,8000) n`,
    );
    await pool.query(
      `INSERT INTO rca_orm_comments (id, post_id, body) SELECT n, ((n-1)/3)+1, 'comment-' || n FROM generate_series(1,24000) n`,
    );
    await pool.query('CREATE INDEX ON rca_orm_users(tenant_id,id)');
    await pool.query('CREATE INDEX ON rca_orm_posts(user_id)');
    await pool.query('CREATE INDEX ON rca_orm_comments(post_id)');
    for (const table of ['rca_orm_users', 'rca_orm_posts', 'rca_orm_comments'])
      await pool.query(`ANALYZE ${quoted(table)}`);
    report.seeded = true;
  } else if (values.mode === 'smoke' || values.mode === 'explain') {
    for (const workload of workloads) {
      const expected = normalize(await operation('pg', workload, 0));
      for (const variant of variantNames) {
        if (workload === 'lookup' && (variant === 'deferred' || variant === 'drizzle-relational')) continue;
        captured.length = 0;
        capture = true;
        const actual = normalize(await operation(variant, workload, 0));
        capture = false;
        assert.deepEqual(actual, expected, `${variant}/${workload} result mismatch`);
        assert.equal(captured.length, workload === 'lookup' || variant === 'drizzle-relational' ? 1 : 3);
        const plans = [];
        if (values.mode === 'explain')
          for (const statement of captured)
            plans.push(
              (await pool.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement.text}`, statement.parameters))
                .rows[0]['QUERY PLAN'],
            );
        report.results.push({
          variant,
          workload,
          roots: actual.length,
          posts: actual.flatMap(row => row.posts ?? []).length,
          comments: actual.flatMap(row => row.posts ?? []).flatMap(row => row.comments ?? []).length,
          queries: [...captured],
          plans,
        });
      }
    }
  } else if (values.mode === 'run' || values.mode === 'profile') {
    const clients = await Promise.all(Array.from({ length: poolSize }, () => pool.connect()));
    clients.forEach(client => client.release());
    const inspector = values.profile ? new Session() : null;
    if (inspector) {
      inspector.connect();
      await inspector.post('Profiler.enable');
    }
    try {
      for (let round = 0; round < rounds; round++) {
        const shifted = [
          ...variantNames.slice(round % variantNames.length),
          ...variantNames.slice(0, round % variantNames.length),
        ];
        const order = round % 2 ? shifted.toReversed() : shifted;
        for (const concurrency of concurrencies)
          for (const workload of workloads)
            for (const variant of order) {
              if (workload === 'lookup' && (variant === 'deferred' || variant === 'drizzle-relational')) continue;
              await pass(variant, workload, concurrency, warmup, false);
              const before = await stats();
              if (inspector) await inspector.post('Profiler.start');
              const result = await pass(variant, workload, concurrency, duration, true);
              if (inspector) {
                const { profile } = await inspector.post('Profiler.stop');
                await writeFile(
                  `${values.profile}-${round}-${concurrency}-${workload}-${variant}.cpuprofile`,
                  JSON.stringify(profile),
                );
              }
              result.round = round + 1;
              result.serverBefore = before;
              result.serverAfter = await stats();
              report.results.push(result);
              await writeFile(values.out, `${JSON.stringify(report)}\n`);
              console.log(
                JSON.stringify({
                  variant,
                  workload,
                  round: round + 1,
                  concurrency,
                  operationsPerSecond: result.operationsPerSecond,
                  p99: result.latencyMs.p99,
                }),
              );
            }
      }
    } finally {
      inspector?.disconnect();
    }
  } else throw new Error(`unknown mode ${values.mode}`);
  report.finishedAt = new Date().toISOString();
  await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ mode: values.mode, output: values.out, cases: report.results.length }));
} finally {
  await pool.end();
}
