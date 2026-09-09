import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';

import {
  Controller,
  Module,
  Post,
  assert,
  createApp,
  defineRepository,
  schemaOf,
  type CreateDTO,
  type Ctx,
} from '@zmdb/core';
import { sqlite, sqliteDriver } from '@zmdb/core/sqlite';
import { createQueue, createWorker, jobsExtension, type Clock } from '@zmdb/jobs';
import { createMemoryJobStore } from '@zmdb/jobs-sqlite';

import type { Order } from './schema.js';

export type Jobs = { readonly 'order.created': { readonly orderId: number; readonly name: string } };

const databasePath = process.env.ZMDB_PRODUCT_DATABASE;
if (databasePath === undefined) throw new Error('ZMDB_PRODUCT_DATABASE is required');
const database = new DatabaseSync(databasePath);
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(database), { dialect: sqlite });
const store = createMemoryJobStore();
const clock: Clock = { now: Date.now, sleep: (ms, signal) => delay(ms, undefined, { signal }) };
const queue = createQueue<Jobs>({ store, clock });
const delivered: Jobs['order.created'][] = [];
const errors: string[] = [];
const worker = createWorker<Jobs>({
  store,
  clock,
  concurrency: 1,
  graceMs: 1000,
  leaseMs: 5000,
  timeoutMs: 1000,
  idleMs: 5,
  maxIdleMs: 20,
  handlers: [
    {
      name: 'order.created',
      validate: raw => assert<Jobs['order.created']>(raw),
      async handle(payload) {
        delivered.push(payload);
      },
    },
  ],
  onDead: job => {
    errors.push(`dead job: ${job.jobId}`);
  },
  onHandlerError: (_context, error) => {
    errors.push(String(error));
  },
});
let initialized = 0;
let shutdowns = 0;

@Controller('/orders')
class OrdersController {
  @Post()
  async create(ctx: Ctx<Record<never, string>, CreateDTO<Order>>) {
    const order = await orders.create(assert<CreateDTO<Order>>(ctx.body));
    await queue.enqueue('order.created', { orderId: order.id, name: order.name });
    return order;
  }
  onModuleInit(): void {
    initialized++;
  }
  onShutdown(): void {
    shutdowns++;
  }
}

@Module({ controllers: [OrdersController] })
class ServerModule {}

const app = createApp(ServerModule, { graceMs: 1000, extensions: [jobsExtension({ workers: [worker] })] });
let origin = '';
const listener = createServer((request, response) => {
  void (async () => {
    request.setEncoding('utf8');
    let body = '';
    for await (const chunk of request) {
      if (typeof chunk !== 'string') throw new TypeError('HTTP decoder returned a non-text chunk');
      body += chunk;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    const result = await app.fetch(
      new Request(`${origin}${request.url ?? '/'}`, {
        method: request.method ?? 'GET',
        headers,
        ...(body.length === 0 ? {} : { body }),
      }),
    );
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(await result.text());
  })().catch(error => {
    response.writeHead(500);
    response.end(String(error));
  });
});

let port = 0;
let invalid;
let valid;
try {
  await app.init(); // This starts the selected worker through the same application.
  await new Promise<void>((accept, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', accept);
  });
  const address = listener.address();
  if (address === null || typeof address === 'string') throw new Error('HTTP listener has no TCP address');
  port = address.port;
  origin = `http://127.0.0.1:${String(port)}`;
  const send = (name: string) =>
    fetch(`${origin}/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
      signal: AbortSignal.timeout(5000),
    });
  const rejected = await send('');
  await rejected.text();
  invalid = {
    status: rejected.status,
    orders: database.prepare('SELECT COUNT(*) AS count FROM orders').get()?.count,
    jobs: store.database.prepare('SELECT COUNT(*) AS count FROM zmdb_job').get()?.count,
  };
  const accepted = await send('first order');
  const entity: unknown = await accepted.json();
  const deadline = AbortSignal.timeout(5000);
  let completedJobs;
  for (;;) {
    if (errors.length > 0) throw new Error(errors.join('\n'));
    completedJobs = store.database.prepare("SELECT COUNT(*) AS count FROM zmdb_job WHERE status = 'done'").get()?.count;
    if (completedJobs === 1) break;
    await delay(5, undefined, { signal: deadline });
  }
  valid = {
    status: accepted.status,
    entity,
    stored: database.prepare('SELECT id, name FROM orders ORDER BY id').all(),
    delivered,
    completedJobs,
  };
} finally {
  try {
    if (listener.listening) await listener[Symbol.asyncDispose]();
  } finally {
    try {
      await app[Symbol.asyncDispose]();
    } finally {
      try {
        store[Symbol.dispose]();
      } finally {
        database.close();
      }
    }
  }
}

function isClosed(connection: DatabaseSync): boolean {
  try {
    connection.prepare('SELECT 1');
    return false;
  } catch (error) {
    return error instanceof Error && /not open|closed/i.test(error.message);
  }
}
const probe = createServer();
await new Promise<void>((accept, reject) => {
  probe.once('error', reject);
  probe.listen(port, '127.0.0.1', accept);
});
await probe[Symbol.asyncDispose]();
console.log(
  JSON.stringify({
    invalid,
    valid,
    lifecycle: {
      initialized,
      shutdowns,
      listenerClosed: !listener.listening,
      portRebound: true,
      databaseClosed: isClosed(database),
      storeClosed: isClosed(store.database),
    },
  }),
);
