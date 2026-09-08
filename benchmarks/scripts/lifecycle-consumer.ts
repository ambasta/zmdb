import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

import { Controller, Get, Module, createApp } from 'zmdb';
import { sqliteDriver } from 'zmdb/sqlite';

const database = new DatabaseSync(':memory:');
const driver = sqliteDriver(database);
let initialized = false;
let stopped = false;
let firstQueryMs = 0;

@Controller('/first-work')
class FirstWork {
  async onModuleInit(): Promise<void> {
    await Promise.resolve();
    initialized = true;
  }

  @Get()
  async query(): Promise<{ answer: unknown }> {
    assert(initialized);
    const started = performance.now();
    const rows = await driver.execute({ text: 'SELECT ? + 1 AS answer', parameters: [41] });
    firstQueryMs = performance.now() - started;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.answer, 42);
    return { answer: rows[0]?.answer };
  }

  onShutdown(): void {
    stopped = true;
  }
}

@Module({ controllers: [FirstWork] })
class ApplicationModule {}

const app = createApp(ApplicationModule);
const server = createServer((request, response) => {
  void app
    .fetch(new Request(`http://127.0.0.1${request.url ?? '/'}`))
    .then(async reply => {
      response.writeHead(reply.status, Object.fromEntries(reply.headers));
      response.end(await reply.text());
    })
    .catch(error => {
      response.writeHead(500);
      response.end(String(error));
    });
});

let report;
let shutdownMs = 0;
try {
  const initStarted = performance.now();
  await app.init();
  assert(initialized, 'application init must complete before readiness');
  const applicationInitMs = performance.now() - initStarted;
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  assert(address !== null && typeof address === 'object');
  const processToReadinessMs = performance.now();
  const started = performance.now();
  const response = await fetch(`http://127.0.0.1:${String(address.port)}/first-work`, {
    signal: AbortSignal.timeout(5000),
  });
  const body: unknown = await response.json();
  const firstHttpMs = performance.now() - started;
  assert.equal(response.status, 200);
  assert.deepEqual(body, { answer: 42 });
  const versionRows = await driver.execute({ text: 'SELECT sqlite_version() AS version', parameters: [] });
  const sqliteVersion = versionRows[0]?.version;
  assert.equal(typeof sqliteVersion, 'string');
  report = {
    database: { engine: 'SQLite', version: sqliteVersion },
    applicationInitMs,
    processToReadinessMs,
    firstHttpMs,
    firstApplicationQueryMs: firstQueryMs,
    status: response.status,
    body,
  };
} finally {
  const started = performance.now();
  try {
    if (server.listening) await server[Symbol.asyncDispose]();
  } finally {
    try {
      await app[Symbol.asyncDispose]();
    } finally {
      database.close();
    }
  }
  shutdownMs = performance.now() - started;
}
assert(stopped);
assert.equal(server.listening, false);
assert.throws(() => database.prepare('SELECT 1'), /not open|closed/i);
console.log(JSON.stringify({ ...report, shutdownMs, closed: true }));
