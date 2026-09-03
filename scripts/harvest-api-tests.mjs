#!/usr/bin/env node
// Harvest the upstream functional-test inventory that the API coverage gate maps.
//
// zmdb claims to replace Drizzle, Kysely, MikroORM, NestJS and Typia. `verify:docs-coverage`
// already checks that claim against what those projects *document*; this checks it against
// what they *test*, which is the stronger statement — a documented feature with no test is a
// promise, a tested one is a behaviour someone depends on.
//
// The unit differs per upstream because their test trees are shaped differently, and pretending
// otherwise would be a worse inventory:
//
//   kysely     one row per innermost `describe` suite in test/node/src (their suites already
//              name the capability: 'alter table > add foreign key constraint')
//   drizzle    one row per `test()` title in the shared *-common.ts suites, because those files
//              are flat — 6,500 lines of top-level tests with a single `describe('common')`
//   mikro-orm  one row per feature area under tests/features, because the 4,700 assertions
//              underneath are dominated by the same suite re-run per driver
//   nestjs     one row per e2e spec file under integration/
//   typia      one row per public API function the tests call, since typia's cases are
//              generated: `test_is_ObjectSimple` is one of 1,036 files over ~60 functions
//
// Each row carries the number of upstream assertions it subsumes, so the gate can report the
// denominator honestly rather than counting rows and calling them tests.
//
// EXCLUDEd, because they are not public-API behaviours:
//   * driver/transport bindings (neon, xata, planetscale, d1, turso, pglite, awsdatapi, proxy,
//     redis, nats, mqtt, kafka, grpc, rmq, mongo, oracle, mssql, singlestore) — the same
//     behaviour re-asserted against another wire protocol
//   * regression tests filed against an internal bug (mikro-orm tests/issues, nest repro-*)
//   * the upstream's own test plumbing (test-setup, object-util, performance, disconnects)
//
// Needs network on first run; clones into --cache at the commits pinned in
// tests/api-coverage/inventory.mjs. NOT run in CI — the point of a pinned inventory is that an
// upstream landing a test at 3am does not turn our build red. Re-pin deliberately:
//
//   node scripts/harvest-api-tests.mjs            # report against the current pins
//   node scripts/harvest-api-tests.mjs --write    # rewrite inventory.mjs
//   node scripts/harvest-api-tests.mjs --latest   # move the pins to each default branch first

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_FILE = join(ROOT, 'tests', 'api-coverage', 'inventory.mjs');

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const opt = (name, fallback) => {
  const hit = argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const CACHE = opt('cache', join(homedir(), '.cache', 'zmdb-upstream'));

const { SOURCES } = await import(INVENTORY_FILE);

// ---------------------------------------------------------------------------
// What counts as a public-API behaviour
// ---------------------------------------------------------------------------

/** A row whose subject is a driver, a transport or the upstream's own test rig. */
const EXCLUDE = [
  // driver and transport bindings: the same behaviour over another wire
  /\b(?:neon|xata|planetscale|vercel|netlify|nile|supabase|tidb|turso|libsql|d1|pglite|sql-js|awsdatapi|aws-data-api|op-sqlite|expo|durable-?objects?|cloudflare|proxy)\b/i,
  /\b(?:redis|nats|mqtt|kafka|grpc|rmq|rabbit|mosquitto|amqp)\b/i,
  /\b(?:mongoose|mongo|oracle|oracledb|mssql|singlestore|cockroach|mariadb)/i,
  // The upstream's own plumbing, not their API. Anchored at the head of the row and stopped at
  // the first ` > ` because a kysely row is `file > suite`: `^…$` never matched `object-util >
  // object util`, so three of their internal helpers were sitting in the inventory asking to be
  // mapped to a zmdb test that has no business existing.
  /^(?:test-setup|object-util|performance|disconnects|error-stack|log-once|query-id|version)(?:$| >)/,
  /\b(?:webpack|bench|benchmark|deno|bun|browser)\b/i,
  // regressions filed against an internal bug
  /\b(?:issues?|repro)[-_]?\d/i,
  /^(?:GH|gh)[-_]?\d+/,
];

const excluded = id => EXCLUDE.some(re => re.test(id));

/** Dialect tokens that make two rows the same behaviour asserted twice. */
const DIALECT =
  /\b(?:postgres|postgresql|postgre|pg|mysql|mysql2|sqlite|sqlite3|better-sqlite3?|node-postgres|postgres-js|express|fastify)\b[.:_-]?/gi;

const normalize = title =>
  title
    .replace(/\$\{[^}]*\}/g, '') // template-literal variants: `${variant}: schema`
    .replace(/^\s*[:>-]\s*/, '')
    .replace(/\s+/g, ' ')
    .replace(/^should\s+/i, '')
    .trim();

/**
 * Collapse rows that differ only by which dialect or HTTP adapter ran them.
 *
 * Removing the token leaves the separator that attached it behind, and a dangling one is enough
 * to keep two rows apart: `exclude-middleware-fastify` became `exclude-middleware-`, which is
 * not `exclude-middleware`, so the same ten assertions were counted as two suites.
 */
const dedialect = id =>
  normalize(id.replace(DIALECT, ''))
    .replace(/[.:_-]{2,}/g, '-')
    .replace(/[\s.:_-]+$/, '')
    .replace(/^[\s.:_-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

// ---------------------------------------------------------------------------
// Harvest modes
// ---------------------------------------------------------------------------

const HARVEST = {
  kysely: { mode: 'suite', dir: 'test/node/src', match: /\.test\.ts$/ },
  drizzle: {
    mode: 'title',
    dir: 'integration-tests/tests',
    // The driver test files import these; the behaviours live here exactly once.
    files: ['pg/pg-common.ts', 'sqlite/sqlite-common.ts', 'relational/pg.test.ts'],
  },
  'mikro-orm': { mode: 'area', dir: 'tests/features' },
  nestjs: { mode: 'file', dir: 'integration', match: /\.spec\.ts$/ },
  typia: { mode: 'api', dir: 'tests', match: /\.ts$/ },
};

const TEST_CALL = /^(\s*)(?:it|test)(?:\.\w+)*\s*\(/;
const DESCRIBE_CALL = /^\s*describe(?:\.\w+)*\s*\(\s*(['"`])([\s\S]*?)\1/;
const TITLE = /^\s*(?:it|test)(?:\.\w+)*\s*\(\s*(['"`])([\s\S]*?)\1/;

/** How many `describe` levels a row keeps. Deeper than this stops naming a capability and
 *  starts enumerating a truth table — kysely's logging suite nests four booleans deep. */
const MAX_PATH = 2;

function walk(dir, match, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

/** Strings and comments, blanked so their braces do not count towards nesting depth. */
const blankInert = line =>
  line
    .replace(/\\./g, '__')
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''")
    .replace(/\/\/.*$/, '')
    .replace(/\/\*.*?\*\//g, '');

/**
 * The `describe` path each assertion sits under, tracked by brace depth.
 *
 * Indentation looks like it would do, and does not: kysely's schema suite wraps its
 * dialect-specific describes in `if (dialect === 'mysql') {`, which indents a sibling suite one
 * level deeper than the one before it. Reading that as nesting filed `add unique constraint`
 * under `drop column`. Depth is the structure; indentation is a rendering of it.
 */
function suites(file, text) {
  const rows = [];
  const stack = [];
  let depth = 0;
  for (const line of text.split('\n')) {
    const inert = blankInert(line);
    const before = depth;
    for (const ch of inert) {
      if (ch === '{' || ch === '(') depth++;
      else if (ch === '}' || ch === ')') depth--;
    }
    const d = DESCRIBE_CALL.exec(line);
    if (d) {
      // A sibling suite opens at the same depth as the one it follows, so `>=` here.
      while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
      const name = normalize(d[2]);
      if (name) stack.push({ name, depth });
      continue;
    }
    if (!TEST_CALL.test(line)) continue;
    while (stack.length > 0 && stack[stack.length - 1].depth > before) stack.pop();
    const path = [];
    for (const seg of [file, ...stack.map(s => s.name)]) {
      if (path[path.length - 1] !== seg) path.push(seg);
    }
    rows.push(path.slice(0, MAX_PATH + 1).join(' > '));
  }
  return rows;
}

function harvestSource(key, src) {
  const cfg = HARVEST[key];
  const repo = join(CACHE, src.repo.split('/')[1]);
  const base = join(repo, cfg.dir);
  const counts = new Map();
  const bump = (id, n = 1) => counts.set(id, (counts.get(id) ?? 0) + n);

  if (cfg.mode === 'suite') {
    for (const file of walk(base, cfg.match)) {
      const name = relative(base, file).replace(/\.test\.ts$/, '');
      for (const suite of suites(name, readFileSync(file, 'utf8'))) bump(suite);
    }
  } else if (cfg.mode === 'title') {
    for (const rel of cfg.files) {
      const text = readFileSync(join(base, rel), 'utf8');
      for (const line of text.split('\n')) {
        const m = TITLE.exec(line);
        if (m) bump(normalize(m[2]));
      }
    }
  } else if (cfg.mode === 'area') {
    for (const entry of readdirSync(base)) {
      const full = join(base, entry);
      const isDir = statSync(full).isDirectory();
      const area = isDir ? entry : entry.replace(/\.test\.ts$/, '');
      if (!isDir && !entry.endsWith('.test.ts')) continue;
      const files = isDir ? walk(full, /\.ts$/) : [full];
      let n = 0;
      for (const f of files) n += (readFileSync(f, 'utf8').match(new RegExp(TEST_CALL, 'gm')) ?? []).length;
      if (n > 0) bump(area, n);
    }
  } else if (cfg.mode === 'file') {
    for (const file of walk(base, cfg.match)) {
      const text = readFileSync(file, 'utf8');
      const n = (text.match(new RegExp(TEST_CALL, 'gm')) ?? []).length;
      if (n > 0) bump(relative(base, file).replace(/\.spec\.ts$/, ''), n);
    }
  } else if (cfg.mode === 'api') {
    for (const file of walk(base, cfg.match)) {
      for (const hit of readFileSync(file, 'utf8').matchAll(/\btypia\.(?:(\w+)\.)?(\w+)\s*[(<]/g)) {
        bump(hit[1] ? `${hit[1]}.${hit[2]}` : hit[2]);
      }
    }
  }

  // Collapse dialect/adapter duplicates, then drop what is not a public-API behaviour.
  const merged = new Map();
  for (const [id, n] of counts) {
    const key2 = dedialect(id);
    if (!key2) continue;
    merged.set(key2, (merged.get(key2) ?? 0) + n);
  }
  const rows = [...merged].filter(([id]) => !excluded(id)).toSorted(([a], [b]) => a.localeCompare(b));
  const dropped = merged.size - rows.length;
  return { rows, dropped, raw: [...counts.values()].reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------------------
// Clone / pin
// ---------------------------------------------------------------------------

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function ensure(key, src) {
  const cfg = HARVEST[key];
  const dir = join(CACHE, src.repo.split('/')[1]);
  mkdirSync(CACHE, { recursive: true });
  if (!existsSync(join(dir, '.git'))) {
    console.log(`  cloning ${src.repo} …`);
    git(['clone', '-q', '--filter=blob:none', '--no-checkout', `https://github.com/${src.repo}.git`, dir], CACHE);
  }
  if (flag('latest')) {
    git(['fetch', '-q', '--depth', '1', 'origin', src.branch], dir);
    src.commit = git(['rev-parse', 'FETCH_HEAD'], dir);
  } else {
    try {
      git(['cat-file', '-e', `${src.commit}^{commit}`], dir);
    } catch {
      git(['fetch', '-q', '--depth', '1', 'origin', src.commit], dir);
    }
  }
  git(['sparse-checkout', 'set', '--no-cone', `/${cfg.dir}/`], dir);
  git(['checkout', '-q', src.commit], dir);
  return dir;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const results = {};
for (const [key, src] of Object.entries(SOURCES)) {
  console.log(`${src.label}:`);
  ensure(key, src);
  results[key] = harvestSource(key, src);
  const { rows, dropped, raw } = results[key];
  console.log(
    `  ${String(rows.length).padStart(4)} rows  ` +
      `${String(rows.reduce((n, [, c]) => n + c, 0)).padStart(5)} assertions  ` +
      `(${dropped} rows excluded as driver/plumbing, ${raw} assertions seen)`,
  );
}

const totalRows = Object.values(results).reduce((n, r) => n + r.rows.length, 0);
const totalAssertions = Object.values(results).reduce((n, r) => n + r.rows.reduce((m, [, c]) => m + c, 0), 0);
console.log(`\ntotal: ${totalRows} rows over ${totalAssertions} upstream assertions`);

if (!flag('write')) {
  const current = await import(`${INVENTORY_FILE}?t=${Date.now()}`);
  for (const [key, { rows }] of Object.entries(results)) {
    const was = new Set(Object.keys(current.INVENTORY[key] ?? {}));
    const now = new Set(rows.map(([id]) => id));
    const added = [...now].filter(id => !was.has(id));
    const gone = [...was].filter(id => !now.has(id));
    for (const id of added) console.log(`  + ${key}: ${id}`);
    for (const id of gone) console.log(`  - ${key}: ${id}`);
  }
  console.log('\n(run with --write to update tests/api-coverage/inventory.mjs)');
  process.exit(0);
}

const header = readFileSync(INVENTORY_FILE, 'utf8').split('export const SOURCES')[0];
const q = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const lines = [header.trimEnd(), '', 'export const SOURCES = {'];
for (const [key, src] of Object.entries(SOURCES)) {
  lines.push(`  ${q(key)}: {`);
  for (const [k, v] of Object.entries(src)) lines.push(`    ${k}: ${typeof v === 'string' ? q(v) : v},`);
  lines.push('  },');
}
lines.push('};', '');
lines.push('export const INVENTORY = {');
for (const [key, { rows }] of Object.entries(results)) {
  lines.push(`  ${q(key)}: {`);
  for (const [id, n] of rows) lines.push(`    ${q(id)}: ${n},`);
  lines.push('  },');
}
lines.push('};', '');
lines.push(`export const TOTAL_UPSTREAM_SUITES = ${totalRows};`);
lines.push(`export const TOTAL_UPSTREAM_ASSERTIONS = ${totalAssertions};`, '');
writeFileSync(INVENTORY_FILE, lines.join('\n'));
console.log(`wrote ${relative(ROOT, INVENTORY_FILE)}`);
