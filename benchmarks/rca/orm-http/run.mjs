// Diagnostic replay of the existing Northwind workload. Competitor rankings
// deliberately come from the separately matched ORM workloads.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const work = resolve(process.env.BENCH_OUT);
const require = createRequire(join(root, 'package.json'));
const { build } = require('esbuild');
const harness = join(root, 'benchmarks/harness/orm');
const profile = process.env.PROFILE === '1';
const instrument = process.env.INSTRUMENT === '1';
const pool = Number(process.env.POOL_MAX ?? 12);
const vus = Number(process.env.VUS ?? 400);
const duration = process.env.DURATION ?? '25s';
const label = process.env.LABEL ?? `pool${pool}-vus${vus}`;
const port = 55439;
await mkdir(work, { recursive: true });
await symlink(join(harness, 'node_modules'), join(work, 'node_modules')).catch(error => {
  if (error.code !== 'EEXIST') throw error;
});

let source = await readFile(join(harness, 'server.ts'), 'utf8');
source = source.replace('max: 12,', `max: ${pool},`);
if (instrument) {
  const start = source.indexOf('const zq = ');
  const end = source.indexOf('\nconst app = ', start);
  if (start === -1 || end === -1) throw new Error('Cannot locate existing query execution function');
  source =
    source.slice(0, start) +
    `
const spans = [];
const zq = async (text, values) => {
  const begin = performance.now();
  const client = await pool.connect();
  const acquired = performance.now();
  try {
    const result = await client.query(PREPARED ? { name: nameFor(text), text, values } : {text, values});
    const end = performance.now();
    spans.push([acquired - begin, end - acquired, end - begin]);
    return result.rows;
  } finally { client.release(); }
};
process.on('SIGTERM', () => {
  const percentile = (values, p) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))];
  const result = { count: spans.length, note: 'Instrumented pool spans; query roundtrip includes network, server, decoding and JS scheduling. Warmup included.' };
  for (const [i, name] of ['poolWaitMs', 'queryRoundtripMs', 'totalMs'].entries()) {
    const values = spans.map(row => row[i]);
    result[name] = { mean: values.reduce((a, b) => a + b, 0) / values.length, p50: percentile(values, .5), p95: percentile(values, .95), p99: percentile(values, .99) };
  }
  writeFileSync(process.env.SPAN_FILE, JSON.stringify(result, null, 2));
  process.exit(0);
});
` +
    source.slice(end);
  source = "import {writeFileSync} from 'node:fs';\n" + source;
} else {
  source += "\nprocess.on('SIGTERM', () => process.exit(0));\n";
}
const serverFile = join(work, `server-${label}.mjs`);
await build({
  stdin: { contents: source, resolveDir: harness, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node26',
  sourcemap: true,
  outfile: serverFile,
  external: ['pg', 'hono', '@hono/node-server', 'drizzle-orm', 'drizzle-orm/*', 'kysely'],
});

const k6Source = `
import {scenario} from 'k6/execution';
import http from 'k6/http';
import {SharedArray} from 'k6/data';
import {Trend} from 'k6/metrics';
const data = new SharedArray('requests', () => JSON.parse(open(__ENV.REQ)));
const groups = new SharedArray('groups', () => [...new Set(JSON.parse(open(__ENV.REQ)).map(x => x.split('?')[0]))]);
const trends = Object.fromEntries(groups.map(x => [x, new Trend('lat_' + x.replace(/[^A-Za-z0-9_]/g, '_'), true)]));
export const options = { vus: Number(__ENV.VUS), duration: __ENV.DURATION, thresholds: {http_req_failed:['rate==0']} };
export default function () {
  const path = data[scenario.iterationInTest % data.length];
  const response = http.get(__ENV.HOST + path);
  trends[path.split('?')[0]].add(response.timings.duration);
}
`;
const loadFile = join(work, 'load.js');
await writeFile(loadFile, k6Source);
function run(command, args, env = {}) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', x => {
      output += x;
    });
    child.stderr.on('data', x => {
      output += x;
    });
    child.on('error', reject);
    child.on('exit', code => (code === 0 ? accept(output) : reject(new Error(`${command}: ${code}\n${output}`))));
  });
}
const server = spawn(
  'taskset',
  [
    '-c',
    '4',
    process.execPath,
    ...(profile ? ['--cpu-prof', `--cpu-prof-dir=${work}`, `--cpu-prof-name=${label}.cpuprofile`] : []),
    serverFile,
  ],
  {
    env: { ...process.env, ORM: 'zmdb', PORT: String(port), SPAN_FILE: join(work, `${label}-spans.json`) },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let serverLog = '';
server.stdout.on('data', x => {
  serverLog += x;
});
server.stderr.on('data', x => {
  serverLog += x;
});
const stopped = new Promise(accept => server.on('exit', accept));
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/customer-by-id?id=1`);
      const value = await response.json();
      if (response.ok && Array.isArray(value) && value.length === 1) {
        ready = true;
        break;
      }
    } catch {
      /* Startup only. */
    }
    if (server.exitCode !== null) throw new Error(serverLog);
    await new Promise(accept => setTimeout(accept, 50));
  }
  if (!ready) throw new Error(`Server did not start: ${serverLog}`);
  const env = {
    HOST: `http://127.0.0.1:${port}`,
    REQ: join(root, 'benchmarks/upstream/drizzle-benchmarks/data/requests.json'),
  };
  await run('taskset', ['-c', '12-15', process.env.K6, 'run', '--quiet', loadFile], {
    ...env,
    VUS: '50',
    DURATION: '5s',
  });
  const output = await run(
    'taskset',
    [
      '-c',
      '12-15',
      process.env.K6,
      'run',
      '--quiet',
      '--summary-trend-stats=avg,min,med,p(90),p(95),p(99),max',
      `--summary-export=${join(work, `${label}.json`)}`,
      loadFile,
    ],
    { ...env, VUS: String(vus), DURATION: duration },
  );
  await writeFile(join(work, `${label}.log`), output);
  console.log(`${label} completed`);
} finally {
  server.kill('SIGTERM');
  await stopped;
  await writeFile(join(work, `${label}-server.log`), serverLog);
}
