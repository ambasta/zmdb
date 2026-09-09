import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const outputArgument = option('out');
assert(outputArgument, 'Pass --out=<prepared output directory>');
const out = path.resolve(outputArgument);
const root = path.resolve(import.meta.dirname, '../../..');
const mode = option('mode', 'smoke');
assert(['smoke', 'measure', 'profile'].includes(mode), `unknown mode ${mode}`);
const knownCandidates = [
  'zmdb-node',
  'fastify-node',
  'hono-node',
  'raw-node',
  'zmdb-bun',
  'elysia-bun',
  'raw-bun',
  'zmdb-deno',
  'hono-deno',
];
const candidates = option('candidates', knownCandidates.join(',')).split(',');
for (const candidate of candidates) assert(knownCandidates.includes(candidate), `unknown candidate ${candidate}`);
const selectedEngines = new Set(candidates.map(candidate => candidate.split('-').at(-1)));
const runtime = {
  node: process.execPath,
  bun: option('bun', 'bun'),
  deno: option('deno', path.join(root, 'benchmarks/harness/framework/.bin/deno')),
};
const oha = option('oha', path.join(root, 'benchmarks/harness/framework/.bin/oha'));
const serverCpu = option('server-cpu', '4');
const clientCpu = option('client-cpu', '10,12,14');
const seconds = Number(option('seconds', '8'));
const warmup = Number(option('warmup', '2'));
const passes = Number(option('passes', '3'));
const connections = option('connections', '64').split(',').map(Number);
assert(
  connections.every(value => Number.isInteger(value) && value > 0),
  'connections must be positive integers',
);
const rate = Number(option('rate', '0'));
assert(Number.isFinite(rate) && rate >= 0, 'rate must be nonnegative');
const keepalive = option('keepalive', 'on');
assert(['on', 'off'].includes(keepalive), 'keepalive must be on or off');
const contract = option('contract', 'validation');
assert(['validation', 'published'].includes(contract), 'contract must be validation or published');
const bundle = option('bundle', contract === 'published' ? 'zmdb-published' : 'zmdb');
const requestBody = JSON.stringify({ name: 'Ada', email: 'ada@example.test' });
const allWorkloads =
  contract === 'published'
    ? {
        root: { path: '/', expected: '' },
        parameter: { path: '/user/42', expected: '42' },
        post: { path: '/user', method: 'POST', expected: '' },
      }
    : {
        text: { path: '/text', expected: 'hello world' },
        parameter: { path: '/user/42', expected: '42' },
        validation: { path: '/user', method: 'POST', body: requestBody, expected: requestBody },
      };
const workloads = option('workloads', contract === 'published' ? 'root,parameter,post' : 'parameter,validation').split(
  ',',
);
for (const name of workloads) assert(allWorkloads[name], `unknown workload ${name}`);
const runDirectory = path.join(out, `${mode}-${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(runDirectory, { recursive: true });
const owned = new Set();
const result = {
  mode,
  startedAt: new Date().toISOString(),
  prepared: JSON.parse(await readFile(path.join(out, 'prepared.json'), 'utf8')),
  runtimes: Object.fromEntries(
    Object.entries(runtime)
      .filter(([name]) => selectedEngines.has(name))
      .map(([name, binary]) => [name, execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim()]),
  ),
  oha: mode === 'smoke' ? undefined : execFileSync(oha, ['--version'], { encoding: 'utf8' }).trim(),
  settings: {
    candidates,
    contract,
    bundle,
    workloads,
    serverCpu,
    clientCpu,
    passes,
    seconds,
    warmup,
    connections,
    rate: rate || undefined,
    processes: 1,
    http: '1.1',
    keepalive: keepalive === 'on',
    load:
      rate > 0
        ? `fixed offered rate ${rate} requests/second; oha latency correction enabled`
        : 'closed loop maximum throughput; latency is not coordinated-omission corrected',
    rawPeers: 'minimal HTTP ceilings, not feature-equivalent framework implementations',
  },
  checks: [],
  samples: [],
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function child(command, commandArgs, options = {}) {
  const process = spawn(command, commandArgs, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...options });
  if (Number.isInteger(process.pid) && process.pid > 0) owned.add(process);
  return process;
}

async function stop(process) {
  if (process.exitCode !== null || process.signalCode !== null) {
    owned.delete(process);
    return;
  }
  const exited = once(process, 'exit');
  try {
    process.kill('SIGTERM');
  } catch {}
  await Promise.race([exited, delay(3000)]);
  if (process.exitCode === null && process.signalCode === null && process.pid > 0) {
    try {
      globalThis.process.kill(-process.pid, 'SIGKILL');
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
    await exited;
  }
  owned.delete(process);
}

async function start(candidate, suffix) {
  const engine = candidate.split('-').at(-1);
  assert(runtime[engine], `unknown engine ${engine}`);
  const nonce = crypto.randomUUID();
  const flags =
    engine === 'deno'
      ? ['run', '--no-check', '--allow-net=127.0.0.1', '--allow-read', '--allow-env', '--allow-sys']
      : [];
  if (mode === 'profile') {
    assert.notEqual(engine, 'bun', 'Profile mode supports the Node and Deno V8 profilers');
    if (engine === 'deno') flags.push('--inspect=127.0.0.1:0');
    else flags.push('--cpu-prof', `--cpu-prof-dir=${runDirectory}`, `--cpu-prof-name=${suffix}.cpuprofile`);
  }
  const process = child('taskset', [
    '-c',
    serverCpu,
    runtime[engine],
    ...flags,
    path.join(import.meta.dirname, 'server.mjs'),
    candidate,
    out,
    nonce,
    bundle,
    contract,
  ]);
  let stdout = '',
    stderr = '';
  process.stdout.on('data', chunk => {
    stdout += chunk;
  });
  process.stderr.on('data', chunk => {
    stderr += chunk;
  });
  process.on('error', error => {
    stderr += error.stack;
  });
  const deadline = Date.now() + 20_000;
  let ready;
  while (Date.now() < deadline) {
    for (const line of stdout.split('\n')) {
      try {
        const value = JSON.parse(line);
        if (value.nonce === nonce) ready = value;
      } catch {}
    }
    if (ready) break;
    if (process.exitCode !== null || process.signalCode !== null)
      throw new Error(`${candidate} exited before ready: ${stderr}\n${stdout}`);
    await delay(30);
  }
  assert(ready, `${candidate} readiness timeout: ${stderr}`);
  const base = `http://127.0.0.1:${ready.port}`;
  assert.equal(ready.pid, process.pid);
  let saveProfile;
  if (mode === 'profile' && engine === 'deno') {
    const endpoint = stderr.match(/ws:\/\/[^\s]+/)?.[0];
    assert(endpoint, `Deno inspector endpoint missing: ${stderr}`);
    const socket = new WebSocket(endpoint);
    await once(socket, 'open');
    let sequence = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      clearTimeout(entry.timeout);
      if (response.error) entry.reject(new Error(JSON.stringify(response.error)));
      else entry.resolve(response.result);
    });
    const command = method =>
      new Promise((resolve, reject) => {
        const id = ++sequence;
        const timeout = setTimeout(() => {
          pending.delete(id);
          socket.close();
          reject(new Error(`Inspector command timed out: ${method}`));
        }, 5000);
        pending.set(id, { resolve, reject, timeout });
        socket.send(JSON.stringify({ id, method }));
      });
    await command('Profiler.enable');
    await command('Profiler.start');
    saveProfile = async () => {
      try {
        const { profile } = await command('Profiler.stop');
        await writeFile(path.join(runDirectory, `${suffix}.cpuprofile`), JSON.stringify(profile));
      } finally {
        socket.close();
      }
    };
  }
  return {
    process,
    base,
    saveProfile,
    save: () => writeFile(path.join(runDirectory, `${suffix}.server.log`), `${stdout}\n${stderr}`),
  };
}

async function check(server, candidate) {
  for (const [name, workload] of Object.entries(allWorkloads)) {
    const response = await fetch(server.base + workload.path, {
      signal: AbortSignal.timeout(10_000),
      method: workload.method,
      body: workload.body,
      headers: workload.body ? { 'content-type': 'application/json' } : undefined,
    });
    assert.equal(response.status, 200, `${candidate}/${name} status`);
    assert.equal(await response.text(), workload.expected, `${candidate}/${name} body`);
  }
  for (const body of contract === 'validation'
    ? [JSON.stringify({ name: 1, email: 'ada@example.test' }), '{', '']
    : []) {
    const response = await fetch(`${server.base}/user`, {
      signal: AbortSignal.timeout(10_000),
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
    });
    assert(
      response.status >= 400 && response.status < 500,
      `${candidate} invalid JSON/schema status ${response.status}`,
    );
    await response.arrayBuffer();
  }
  result.checks.push({ candidate, requests: contract === 'validation' ? 6 : 3, passed: true });
}

async function load(server, workloadName, duration, concurrency, label) {
  const workload = allWorkloads[workloadName];
  const flags = [
    '--no-tui',
    '--output-format',
    'json',
    '--http-version',
    '1.1',
    '--disable-compression',
    '-c',
    String(concurrency),
    '-z',
    `${duration}s`,
    '-w',
    '-t',
    '5s',
  ];
  if (workload.method) flags.push('-m', workload.method);
  if (workload.body !== undefined) flags.push('-T', 'application/json', '-d', workload.body);
  if (keepalive === 'off') flags.push('--disable-keepalive');
  if (rate > 0) flags.push('-q', String(rate), '--latency-correction');
  const process = child('taskset', ['-c', clientCpu, oha, ...flags, server.base + workload.path]);
  let stdout = '',
    stderr = '';
  process.stdout.on('data', chunk => {
    stdout += chunk;
  });
  process.stderr.on('data', chunk => {
    stderr += chunk;
  });
  const [code] = await once(process, 'exit');
  owned.delete(process);
  await writeFile(path.join(runDirectory, `${label}.json`), stdout);
  await writeFile(path.join(runDirectory, `${label}.stderr`), stderr);
  assert.equal(code, 0, `${label} load generator: ${stderr}`);
  const report = JSON.parse(stdout);
  assert.equal(report.summary.successRate, 1, `${label} request failures`);
  assert(
    Object.keys(report.statusCodeDistribution).every(status => status === '200'),
    `${label} unexpected statuses`,
  );
  assert(Object.keys(report.errorDistribution).length === 0, `${label} transport errors`);
  return { ...report, command: ['taskset', '-c', clientCpu, oha, ...flags, server.base + workload.path] };
}

try {
  if (mode === 'smoke') {
    for (const candidate of candidates) {
      const server = await start(candidate, candidate);
      try {
        await check(server, candidate);
      } finally {
        await stop(server.process);
        await server.save();
      }
      console.log(`${candidate}: ${contract} contract smoke passed`);
    }
  } else {
    for (let pass = 0; pass < passes; pass++) {
      const levels = [
        ...connections.slice(pass % connections.length),
        ...connections.slice(0, pass % connections.length),
      ];
      for (const [levelIndex, concurrency] of levels.entries()) {
        const offset = (pass + levelIndex) % candidates.length;
        const order = [...candidates.slice(offset), ...candidates.slice(0, offset)];
        for (const candidate of order) {
          const label = `${pass + 1}-c${concurrency}-${candidate}`;
          const server = await start(candidate, label);
          try {
            await check(server, candidate);
            const workloadOffset = (pass + levelIndex) % workloads.length;
            const workloadOrder = [...workloads.slice(workloadOffset), ...workloads.slice(0, workloadOffset)];
            for (const workload of workloadOrder) {
              await load(server, workload, warmup, concurrency, `${label}-${workload}-warmup`);
              const report = await load(server, workload, seconds, concurrency, `${label}-${workload}`);
              result.samples.push({
                pass: pass + 1,
                connections: concurrency,
                candidate,
                workload,
                route: `${allWorkloads[workload].method ?? 'GET'} ${allWorkloads[workload].path}`,
                rps: report.summary.requestsPerSec,
                p95Milliseconds: report.latencyPercentiles.p95 * 1000,
                p99Milliseconds: report.latencyPercentiles.p99 * 1000,
                meanMilliseconds: report.summary.average * 1000,
                bytes: report.summary.totalData,
                command: report.command,
                statusCodeDistribution: report.statusCodeDistribution,
                errorDistribution: report.errorDistribution,
              });
              console.log(JSON.stringify(result.samples.at(-1)));
            }
            await check(server, candidate);
          } finally {
            await server.saveProfile?.();
            await stop(server.process);
            await server.save();
          }
        }
      }
    }
  }
} catch (error) {
  result.error = error.stack;
  process.exitCode = 1;
  console.error(error);
} finally {
  for (const process of owned) await stop(process);
  result.finishedAt = new Date().toISOString();
  result.cleaned = owned.size === 0;
  await writeFile(path.join(runDirectory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`Result: ${path.join(runDirectory, 'result.json')}`);
}
