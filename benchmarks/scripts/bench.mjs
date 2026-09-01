// Runs the three upstream benchmark suites with zmdb grafted in, and normalises
// whatever was actually measured into the JSON the docs dashboard renders.
//
//   node benchmarks/scripts/bench.mjs [validation|orm|framework|all] [flags]
//
//   --normalize-only   skip measurement; re-derive the dashboard JSON from the
//                      raw results already on disk
//   --install          allow the suite to install its own dependencies
//   --skip-unavailable exit 0 when a suite's preconditions are missing
//   --libs a,b,c       validation only: which competitors to run alongside zmdb
//
// The honesty rules this script enforces, because they are the only reason the
// numbers are worth anything:
//
//   1. It never invents a result. A suite whose preconditions are missing is
//      reported as not-run, and the dashboard keeps the last real measurement
//      with its own timestamp and machine string attached.
//   2. It never overwrites measured data with a partial re-run. Normalisation
//      reads raw results; if the raw file is absent, the suite is skipped rather
//      than emitted empty.
//   3. Every normalised file records where the number came from: upstream commit,
//      runtime version, machine, methodology and the wall-clock time.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, arch, cpus, platform, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SUITES, graft, submodulePresent } from './graft.mjs';

const BENCH = dirname(dirname(fileURLToPath(import.meta.url)));
const ROOT = dirname(BENCH);
const SITE = join(BENCH, 'site');

// The set of validation libraries to run. Read from the submodule's own case
// registry rather than hard-coded here, so a submodule bump adds the new
// libraries automatically instead of silently narrowing the field to whatever
// list happened to be true when this was written.
function validationCases() {
  const registry = join(ROOT, SUITES.validation.submodule, 'cases', 'index.ts');
  if (!existsSync(registry)) return [];
  const source = readFileSync(registry, 'utf8');
  const list = source.slice(source.indexOf('['), source.indexOf(']'));
  return [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
}

// The registry lists case *slugs* — a file or directory under `cases/`. The
// results file records the display name the case passes to `createCase()`, and the
// two are often different: `mol_data` reports itself as `$mol_data`, `typebox`
// reports three separate rows. Comparing slugs against result names directly
// reports libraries that ran perfectly well as not-run, so read the names each
// case actually declares.
function declaredNames(slug) {
  const cases = join(ROOT, SUITES.validation.submodule, 'cases');
  const single = join(cases, `${slug}.ts`);
  // A directory case registers in its own index.ts (sometimes under src/). Its
  // `build/` holds vendored compiler output — megabytes of it, containing the word
  // `createCase` for entirely unrelated reasons — so the search is deliberately
  // shallow rather than recursive.
  const candidates = existsSync(single)
    ? [single]
    : [join(cases, slug, 'index.ts'), join(cases, slug, 'src', 'index.ts')];

  const names = new Set();
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const source = readFileSync(path, 'utf8');
    // Both `addCase` and `createCase` are in use upstream, and a name may be
    // single-quoted, double-quoted or a backtick string.
    for (const match of source.matchAll(/(?:add|create)Case\(\s*['"`]([^'"`]+)['"`]/g)) names.add(match[1]);
  }
  // A case whose registration could not be read is still worth checking under its
  // own slug rather than being dropped from the accounting entirely.
  return names.size > 0 ? [...names] : [slug];
}

function machine() {
  const list = cpus();
  const model = list[0]?.model ?? 'unknown cpu';
  const gib = Math.round(totalmem() / 1024 ** 3);
  return `${platform()} ${arch()}, ${list.length}× ${model.trim()}, ${gib} GiB, node ${process.version}`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function have(tool) {
  return spawnSync('sh', ['-c', `command -v ${tool}`], { stdio: 'ignore' }).status === 0;
}

function upstreamCommit(suite) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: join(ROOT, suite.submodule),
      encoding: 'utf8',
    }).trim();
  } catch {
    return null;
  }
}

function provenance(suiteName, extra) {
  const suite = SUITES[suiteName];
  return {
    suite: suite.label,
    upstreamCommit: upstreamCommit(suite),
    generatedAt: new Date().toISOString(),
    machine: machine(),
    host: hostname(),
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// validation — moltar/typescript-runtime-type-benchmarks
// ---------------------------------------------------------------------------

const validation = {
  raw: () =>
    join(ROOT, SUITES.validation.submodule, 'docs', 'results', `node-${process.versions.node.split('.')[0]}.json`),

  preflight({ install }) {
    const missing = [];
    if (!submodulePresent(SUITES.validation))
      missing.push('submodule (run with --install or `git submodule update --init`)');
    const modules = join(ROOT, SUITES.validation.submodule, 'node_modules');
    if (!existsSync(modules) && !install) missing.push('node_modules in the submodule (pass --install)');
    return missing;
  },

  run({ install, libs }) {
    const cwd = join(ROOT, SUITES.validation.submodule);
    if (install) {
      // --ignore-scripts: several cases build native artefacts that are irrelevant
      // to the participants we run and routinely fail offline.
      // --allow-remote=all: upstream pins @paseri/paseri to a JSR tarball URL, and
      // npm 12 refuses `remote`-type dependencies unless asked. Without it the
      // whole install aborts and no case can run.
      run('npm', ['install', '--allow-remote=all', '--ignore-scripts', '--no-audit', '--no-fund'], cwd);
    }
    // The upstream runner forks one process per case, which is what keeps a
    // library's warm-up from contaminating the next one's numbers. It shells out
    // to `npm run compile:<case>` for the cases that need a build, ours included.
    // ts-node, not tsx: upstream's own `start` script is `ts-node index.ts`, and the
    // runner shells back out to its own npm scripts, so using a different loader
    // here would run the harness under one toolchain and the cases under another.
    run('npx', ['ts-node', 'index.ts', 'run', ...libs], cwd);
  },

  normalize({ libs } = {}) {
    const raw = validation.raw();
    if (!existsSync(raw)) return { written: false, reason: `no upstream results at ${raw}` };

    const results = readJson(raw).results ?? [];
    const kinds = ['parseSafe', 'parseStrict', 'assertLoose', 'assertStrict'];
    const byLibrary = new Map();
    for (const row of results) {
      const entry = byLibrary.get(row.name) ?? { name: row.name, ops: {}, margin: {} };
      entry.ops[row.benchmark] = row.ops;
      entry.margin[row.benchmark] = row.margin;
      entry.runtime = row.runtime;
      entry.runtimeVersion = row.runtimeVersion;
      byLibrary.set(row.name, entry);
    }

    // A library that did not register a case is a DNF for that case, never a
    // zero: zero would sort it last and imply it tried and failed.
    const libraries = [...byLibrary.values()].map(entry => ({
      name: entry.name,
      isZmdb: entry.name === 'zmdb' || entry.name === 'zmdb-aot',
      ops: Object.fromEntries(kinds.map(k => [k, entry.ops[k] ?? null])),
      margin: Object.fromEntries(kinds.map(k => [k, entry.margin[k] ?? null])),
      dnf: kinds.filter(k => entry.ops[k] === undefined),
    }));

    libraries.sort((a, b) => (b.ops.parseSafe ?? 0) - (a.ops.parseSafe ?? 0));

    // The upstream runner catches a case that throws and prints "Skipped" —
    // failures leave no trace in the results file. Publishing the requested set
    // minus the measured set is the only way a reader can tell "this library is
    // slower than zmdb" apart from "this library never ran on this machine".
    const requested = libs !== undefined && libs.length > 0 ? libs : validationCases();
    const notRun = requested
      .map(slug => ({ slug, names: declaredNames(slug) }))
      .filter(entry => !entry.names.some(name => byLibrary.has(name)))
      .map(entry => ({
        name: entry.slug,
        reports: entry.names,
        reason:
          'requested but produced no result — the upstream runner skipped it (build or load error on this runtime)',
      }));

    const out = {
      ...provenance('validation', {
        upstream: 'https://github.com/moltar/typescript-runtime-type-benchmarks',
        methodology:
          "Upstream runner, one forked process per library. Four cases over the suite's fixed " +
          'data model: parseSafe, parseStrict, assertLoose, assertStrict. ops/sec with the ' +
          "runner's own error margin. `zmdb` is the runtime (descriptor-walking) validator; " +
          '`zmdb-aot` is the same code with the transformer applied.',
        runtime: `${results[0]?.runtime ?? 'node'} ${results[0]?.runtimeVersion ?? process.version}`,
      }),
      kinds,
      libraries,
      notRun,
    };
    writeJson(join(SITE, 'validation.json'), out);
    return { written: true, libraries: libraries.length, notRun: notRun.length };
  },
};

// ---------------------------------------------------------------------------
// orm — drizzle-team/drizzle-benchmarks
// ---------------------------------------------------------------------------

const orm = {
  preflight() {
    const missing = [];
    if (!submodulePresent(SUITES.orm)) missing.push('submodule');
    if (!have('k6')) missing.push('k6 (https://github.com/grafana/k6/releases)');
    if (process.env.DATABASE_URL === undefined) missing.push('DATABASE_URL pointing at a seeded Northwind Postgres');
    return missing;
  },

  run() {
    const cwd = join(ROOT, SUITES.orm.submodule);
    throw new Error(
      'orm: driving the upstream k6 replay is not automated yet — it needs a seeded\n' +
        `Northwind database and a two-machine rig to be worth reporting. Reproduce it by hand:\n` +
        `  cd ${cwd}\n` +
        '  npm install && npm run start:seed        # once, against DATABASE_URL\n' +
        '  npm run start:drizzle &                  # then, per participant\n' +
        '  npm run start:zmdb &                     # the grafted participant\n' +
        '  k6 run -e HOST=http://localhost:3000 bench/bench.js --summary-export=/tmp/zmdb.json\n' +
        'then re-run this script with --normalize-only. See benchmarks/harness/README.md.',
    );
  },

  normalize() {
    // The measured run lives in the harness (a real k6 replay against a podman
    // Postgres). Carry it forward rather than re-deriving numbers this script did
    // not produce — and fail loudly if the shape is not what is expected, because
    // a normaliser that quietly emits empty arrays is worse than no dashboard.
    const raw = join(SITE, 'orm-results.json');
    if (!existsSync(raw)) return { written: false, reason: 'no orm-results.json' };

    const measured = readJson(raw);
    for (const key of ['config', 'overall', 'coverage']) {
      if (measured[key] === undefined) {
        return {
          written: false,
          reason: `orm-results.json has no "${key}" — refusing to emit a dashboard with holes in it`,
        };
      }
    }

    // Rank by throughput, but keep the latency columns alongside it: this replay
    // has zmdb ahead on req/s and behind on p90, and reporting only the first
    // would be picking the metric that flatters us.
    const targets = [...measured.overall]
      .toSorted((a, b) => b.reqs - a.reqs)
      .map((row, index) => ({
        rank: index + 1,
        target: row.orm,
        isZmdb: row.orm.startsWith('zmdb'),
        requestsPerSecond: row.reqs,
        averageLatency: row.avg,
        p90: row.p90,
        p95: row.p95,
        failedRequests: row.failed,
      }));

    // The route matrix is per-target booleans upstream; flatten it into rows the
    // dashboard can render as a grid, and derive the per-target coverage count so
    // an incomplete participant cannot be read as a fast one.
    const routeNames = measured.coverage.map(row => row.route);
    const participants = [...new Set(measured.coverage.flatMap(row => Object.keys(row).filter(k => k !== 'route')))];
    const coverage = {
      routes: routeNames,
      participants,
      supported: Object.fromEntries(
        participants.map(name => [name, measured.coverage.filter(row => row[name] === true).map(row => row.route)]),
      ),
      matrix: measured.coverage,
    };

    const out = {
      ...provenance('orm', {
        upstream: 'https://github.com/drizzle-team/drizzle-benchmarks',
        methodology: measured.config.load ?? 'k6 replay of the upstream 13-route request list',
        caveat: measured.config.note ?? null,
        database: measured.config.database ?? null,
        dataset: measured.config.dataset ?? null,
        driver: measured.config.driver ?? null,
        rig: measured.config.machine ?? null,
      }),
      // Preserve the measurement's own timestamp: this script is normalising, not
      // measuring, and stamping "now" on someone else's number is how stale data
      // starts looking fresh.
      measuredAt: measured.generatedAt ?? null,
      metrics: [
        { key: 'requestsPerSecond', label: 'req/s', better: 'higher' },
        { key: 'averageLatency', label: 'avg ms', better: 'lower' },
        { key: 'p90', label: 'p90 ms', better: 'lower' },
        { key: 'p95', label: 'p95 ms', better: 'lower' },
      ],
      targets,
      coverage,
      prepared: measured.prepared ?? null,
      dnf: measured.dnf ?? [],
    };
    writeJson(join(SITE, 'orm.json'), out);
    return { written: true, targets: targets.length, routes: routeNames.length, dnf: out.dnf.length };
  },
};

// ---------------------------------------------------------------------------
// framework — the-benchmarker/web-frameworks
// ---------------------------------------------------------------------------

// The runtimes the contract app is served on besides node. node is not in the
// list because it is the default and its results file is the canonical one every
// other tool reads; these two are the extras that get their own file.
const FRAMEWORK_RUNTIMES = ['bun', 'deno'];

// The interleaved runner names candidates `<framework>-<runtime>`, dropping the
// runtime for the node-only peers, and suffixes our control variant with
// `-handwritten`. Splitting that back apart here keeps the naming convention in
// one place instead of hard-coding a twelve-entry lookup table that goes stale the
// first time a candidate is added.
function interleavedCandidate(id) {
  const isControl = id.endsWith('-handwritten');
  const parts = (isControl ? id.slice(0, -'-handwritten'.length) : id).split('-');
  const runtime = ['node', 'bun', 'deno'].includes(parts.at(-1)) ? parts.pop() : 'node';
  const name = parts.join('-');
  const isZmdb = name === 'zmdb';
  return {
    id,
    label: isZmdb ? '@zmdb/web' : name,
    runtime,
    isZmdb,
    // The hand-written node:http app from git HEAD. It is our own A/B control
    // rather than a competitor, and the dashboard marks it as one so nobody reads
    // it as a peer we happen to beat.
    isControl,
  };
}

// The order-rotated, per-core head-to-head. Kept beside the level/route table
// rather than merged into it, because it is a different experiment: one route, one
// concurrency, every candidate on one process, and a median over passes instead of
// a single block per framework. Absent file means absent section — the runner is
// deliberately not part of `yarn bench:framework`, since it takes far longer.
function interleavedHeadToHead() {
  const file = join(SITE, 'interleaved-results.json');
  if (!existsSync(file)) return null;
  const data = readJson(file);
  if (!Array.isArray(data.results) || data.results.length === 0) return null;
  return {
    generatedAt: data.generatedAt ?? null,
    machine: data.machine ?? null,
    route: data.route ?? null,
    concurrency: data.concurrency ?? null,
    duration: data.duration ?? null,
    keepAlive: data.keepAlive ?? null,
    passes: data.passes ?? null,
    workersPerCandidate: data.workersPerCandidate ?? null,
    methodology: data.methodology ?? null,
    results: data.results.map(r => ({
      ...interleavedCandidate(r.candidate),
      requestsPerSecond: r.medianRequestsPerSec,
      passSpread: r.passSpread ?? null,
      passes: r.passes ?? null,
    })),
  };
}

const framework = {
  preflight() {
    const missing = [];
    if (!submodulePresent(SUITES.framework)) missing.push('submodule');
    const cached = join(BENCH, 'harness', 'framework', '.bin', 'oha');
    if (!have('oha') && !existsSync(cached)) missing.push('oha (https://github.com/hatoo/oha)');
    return missing;
  },

  run() {
    // run.sh builds @zmdb/web, verifies the shared contract, then drives oha at
    // the upstream concurrency levels. peers-run.sh does the same for every peer
    // framework on the same box, which is the only way the comparison is fair.
    // Then the same app on the other two runtimes: same bundle, same contract, so
    // the runtime is the only thing that differs between those rows. These are
    // best-effort, because bun and deno are not required to develop this
    // repository — but a failure is announced, and it leaves no results file, so
    // the runtime is absent from the dashboard rather than present with a
    // placeholder.
    for (const runtime of FRAMEWORK_RUNTIMES) {
      const ok = runSoft('bash', [join(BENCH, 'harness', 'framework', 'run.sh')], BENCH, { RUNTIME: runtime });
      if (!ok) process.stdout.write(`  ! RUNTIME=${runtime} run failed — no ${runtime} row will be published\n`);
    }
    const peers = join(BENCH, 'harness', 'framework', 'peers', 'peers-run.sh');
    if (existsSync(peers)) run('bash', [peers], BENCH);
  },

  normalize() {
    const self = join(SITE, 'framework-results.json');
    const peers = join(SITE, 'peers-results.json');
    if (!existsSync(self)) return { written: false, reason: 'no framework-results.json' };

    const mine = readJson(self);
    if (!Array.isArray(mine.metrics)) {
      return { written: false, reason: 'framework-results.json has no metrics array' };
    }
    const theirs = existsSync(peers) ? readJson(peers) : { peers: [], metrics: [] };

    // Both harnesses emit one flat {level, route, label, value} record per oha
    // measurement. Pivot to one row per (framework, runtime, level, route) so the
    // dashboard can rank within a level and route rather than averaging across
    // them — averaging hides the frameworks that fall over as concurrency climbs,
    // which is the interesting part, and blends a cheap route into an expensive
    // one. The runtime belongs in the key because the same framework appears on
    // more than one of them — ours on three, hono on three — and without it those
    // rows overwrite each other.
    const rows = new Map();
    const pivot = (id, runtime, language, isZmdb, workers, metrics) => {
      for (const m of metrics) {
        const key = `${id}\u0000${runtime}\u0000${m.level}\u0000${m.route}`;
        const row = rows.get(key) ?? {
          id,
          runtime,
          language,
          isZmdb,
          workers,
          level: m.level,
          route: m.route,
          metrics: {},
        };
        row.metrics[m.label] = m.value;
        rows.set(key, row);
      }
    };

    // Our app, once per runtime it was actually measured on. run.sh keeps node in
    // framework-results.json (the file the rest of the tooling reads) and puts each
    // other runtime in its own file, so one runtime's run cannot overwrite
    // another's. A runtime that was never run has no file and therefore no row —
    // not a zero, and not a node number wearing somebody else's label.
    const runtimesMeasured = [];
    for (const runtime of ['node', ...FRAMEWORK_RUNTIMES]) {
      const file = runtime === 'node' ? self : join(SITE, `framework-results-${runtime}.json`);
      if (!existsSync(file)) continue;
      const data = runtime === 'node' ? mine : readJson(file);
      if (!Array.isArray(data.metrics) || data.metrics.length === 0) continue;
      const workers = data.concurrencyModel?.workers ?? null;
      runtimesMeasured.push({
        runtime,
        version: data.runtimeVersion ?? null,
        workers,
        measuredAt: data.generatedAt ?? null,
      });
      pivot(`@zmdb/web (${runtime})`, runtime, 'typescript', true, workers, data.metrics);
    }

    const byId = new Map((theirs.peers ?? []).map(p => [p.id, p]));
    for (const m of theirs.metrics ?? []) {
      const peer = byId.get(m.id);
      // Worker count stays null for peers. Every peer app in this suite serves from
      // one process, but that is an inference about somebody else's code and the
      // column would be stating it on our authority.
      const runtime = m.runtime ?? peer?.runtime ?? 'unknown';
      pivot(m.id, runtime, m.language ?? peer?.language ?? 'unknown', false, null, [m]);
    }

    // A peer that failed to boot or failed the contract check has no metrics, so
    // it would silently vanish from the table. Name it instead.
    const measured = new Set([...rows.values()].map(r => r.id));
    const notRun = (theirs.peers ?? [])
      .filter(p => !measured.has(p.id))
      .map(p => ({ id: p.id, runtime: p.runtime, language: p.language, reason: p.status ?? 'no metrics recorded' }));

    const all = [...rows.values()];
    const out = {
      ...provenance('framework', {
        upstream: 'https://github.com/the-benchmarker/web-frameworks',
        methodology: mine.methodology ?? null,
        contract: mine.contract ?? [],
        contractVerdict: mine.contractVerdict ?? null,
        peerMethodology: theirs.methodology ?? null,
        peerDuration: theirs.duration ?? null,
      }),
      measuredAt: mine.generatedAt ?? null,
      peersMeasuredAt: theirs.generatedAt ?? null,
      levels: [...new Set(all.map(r => r.level))].toSorted((a, b) => a - b),
      routes: [...new Set(all.map(r => r.route))],
      // Which runtimes our own app was measured on, with the version that served
      // it. The table's runtime column is not enough on its own: a reader needs to
      // know that a runtime missing from the table was never run, rather than run
      // and lost.
      runtimesMeasured,
      // Upstream's own published table, on upstream's hardware. Kept in a separate
      // field so it can never be ranked against the same-machine numbers.
      upstreamReference: mine.upstreamReference ?? null,
      rows: all,
      notRun,
      interleaved: interleavedHeadToHead(),
    };
    writeJson(join(SITE, 'framework.json'), out);
    return {
      written: true,
      rows: all.length,
      frameworks: measured.size,
      runtimes: runtimesMeasured.map(r => r.runtime).join('+'),
      notRun: notRun.length,
      interleaved: out.interleaved === null ? 0 : out.interleaved.results.length,
    };
  },
};

const SUITE_IMPL = { validation, orm, framework };

function run(command, args, cwd, env = {}) {
  if (spawn(command, args, cwd, env) !== 0) {
    throw new Error(`${command} exited nonzero or on a signal`);
  }
}

// Same thing, but a failure is reported and the caller decides. Used for the
// optional runtimes: bun and deno are not needed to develop this repository, so a
// missing one must not fail the whole suite — but it must be visible, and it must
// leave no results file behind for the dashboard to pick up.
function runSoft(command, args, cwd, env = {}) {
  return spawn(command, args, cwd, env) === 0;
}

function spawn(command, args, cwd, env) {
  const prefix = Object.entries(env)
    .map(([k, v]) => `${k}=${v} `)
    .join('');
  process.stdout.write(`  $ ${prefix}${command} ${args.join(' ')}\n`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    // The upstream suites use npm; this repository declares yarn in
    // `packageManager`, and corepack refuses to run a different package manager
    // anywhere under that root. The submodules are not part of this workspace, so
    // relaxing strict mode for them is correct rather than a workaround.
    env: { ...process.env, COREPACK_ENABLE_STRICT: '0', ...env },
  });
  return result.status ?? 1;
}

function main() {
  const args = process.argv.slice(2);
  const flag = name => args.includes(`--${name}`);
  const value = name => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit === undefined ? undefined : hit.slice(name.length + 3);
  };

  const requested = args.filter(a => !a.startsWith('--'));
  const names = requested.length === 0 || requested.includes('all') ? Object.keys(SUITE_IMPL) : requested;
  for (const name of names) {
    if (SUITE_IMPL[name] === undefined) {
      process.stderr.write(`bench: unknown suite "${name}" (have: ${Object.keys(SUITE_IMPL).join(', ')}, all)\n`);
      process.exit(2);
    }
  }

  const normalizeOnly = flag('normalize-only');
  const install = flag('install');
  const skip = flag('skip-unavailable');
  // No --libs means the whole field: the upstream runner treats an empty case list
  // as "run everything", and "all feasible libraries" is the only comparison worth
  // publishing. Individual libraries that fail to build are reported as not-run.
  const explicit = value('libs');
  const libs = explicit === undefined ? validationCases() : explicit.split(',').filter(l => l.length > 0);

  let failed = false;
  for (const name of names) {
    const impl = SUITE_IMPL[name];
    process.stdout.write(`\n=== ${SUITES[name].label}\n`);

    if (!normalizeOnly) {
      if (submodulePresent(SUITES[name])) graft(name);
      const missing = impl.preflight({ install });
      if (missing.length > 0) {
        process.stdout.write(`  not run — missing: ${missing.join('; ')}\n`);
        if (!skip) failed = true;
      } else {
        try {
          impl.run({ install, libs });
        } catch (error) {
          process.stdout.write(`  not run — ${error.message}\n`);
          if (!skip) failed = true;
        }
      }
    }

    const normalized = impl.normalize({ libs });
    if (normalized.written) {
      const detail = Object.entries(normalized)
        .filter(([k]) => k !== 'written')
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      process.stdout.write(`  normalised → benchmarks/site/${name}.json ${detail}\n`);
    } else {
      process.stdout.write(`  no dashboard JSON — ${normalized.reason}\n`);
      failed = true;
    }
  }

  process.stdout.write(
    '\nThe dashboard reads benchmarks/site/{validation,orm,framework}.json. Rebuild it with `yarn build:docs`.\n',
  );
  if (failed) process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
