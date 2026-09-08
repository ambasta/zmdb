import assertNode from 'node:assert/strict';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';

import {
  Controller,
  Delete,
  Get,
  Module,
  Patch,
  Post,
  assert,
  createApp,
  defineRepository,
  schemaOf,
  type CreateDTO,
  type Ctx,
  type Entity,
  type UpdateDTO,
} from 'zmdb';
import { sqlite, sqliteDriver } from 'zmdb/sqlite';

import type { Order } from './schema.js';

const databasePath = process.env.ZMDB_PRODUCT_DATABASE;
if (databasePath === undefined) throw new Error('ZMDB_PRODUCT_DATABASE is required');
const database = new DatabaseSync(databasePath);
const orders = defineRepository(schemaOf<Order>(), sqliteDriver(database), { dialect: sqlite });
let shutdowns = 0;

@Controller('/orders')
export class OrdersController {
  @Post()
  async create(ctx: Ctx<Record<never, string>, CreateDTO<Order>>): Promise<Entity<Order>> {
    return orders.create(assert<CreateDTO<Order>>(ctx.body));
  }

  @Get('/:id')
  async read(ctx: Ctx<{ id: string }>): Promise<Entity<Order> | undefined> {
    return orders.findOne({ id: Number(ctx.params.id) });
  }

  @Patch('/:id')
  async update(ctx: Ctx<{ id: string }, UpdateDTO<Order>>): Promise<Entity<Order> | undefined> {
    return orders.update(Number(ctx.params.id), assert<UpdateDTO<Order>>(ctx.body));
  }

  @Delete('/:id')
  async remove(ctx: Ctx<{ id: string }>): Promise<boolean> {
    return orders.delete(Number(ctx.params.id));
  }

  onShutdown(): void {
    shutdowns++;
  }
}

@Module({ controllers: [OrdersController] })
class ProductModule {}

const app = createApp(ProductModule);
let origin = '';
const server = createServer((request, response) => {
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
    const reply = await app.fetch(
      new Request(`${origin}${request.url ?? '/'}`, {
        method: request.method ?? 'GET',
        headers,
        ...(body.length === 0 ? {} : { body }),
      }),
    );
    response.writeHead(reply.status, Object.fromEntries(reply.headers));
    response.end(await reply.text());
  })().catch(error => {
    response.writeHead(500);
    response.end(String(error));
  });
});
let report;
let port = 0;
try {
  await app.init();
  await new Promise<void>((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const address = server.address();
  assertNode(address !== null && typeof address === 'object');
  assertNode.equal(address.address, '127.0.0.1');
  port = address.port;
  origin = `http://127.0.0.1:${String(port)}`;
  const send = async (path: string, method: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, contentType: response.headers.get('content-type'), body: await response.json() };
  };
  const invalid = await send('/orders', 'POST', { name: '' });
  const afterInvalid = database.prepare('SELECT COUNT(*) AS count FROM orders').get();
  const valid = await send('/orders', 'POST', { name: 'first order' });
  const stored = database.prepare('SELECT id, name FROM orders ORDER BY id').all();
  const read = await send('/orders/1', 'GET');
  const update = await send('/orders/1', 'PATCH', { name: 'updated order' });
  const readUpdated = await send('/orders/1', 'GET');
  const remove = await send('/orders/1', 'DELETE');
  const afterDelete = database.prepare('SELECT COUNT(*) AS count FROM orders').get();
  const ledger = database.prepare('SELECT version, name, checksum FROM _zmdb_migrations ORDER BY version').all();
  report = {
    loopback: address.address === '127.0.0.1',
    invalidStatus: invalid.status,
    invalidBody: invalid.body,
    rowsAfterInvalid: afterInvalid?.count,
    validStatus: valid.status,
    contentType: valid.contentType,
    created: valid.body,
    stored,
    read,
    update,
    readUpdated,
    remove,
    rowsAfterDelete: afterDelete?.count,
    ledger,
    columns: database
      .prepare('PRAGMA table_info(orders)')
      .all()
      .map(row => ({ name: row.name, type: row.type, pk: row.pk })),
  };
} finally {
  if (server.listening) await server[Symbol.asyncDispose]();
  try {
    await app[Symbol.asyncDispose]();
  } finally {
    database.close();
  }
}
assertNode.equal(server.listening, false);
assertNode.equal(shutdowns, 1);
assertNode.throws(() => database.prepare('SELECT 1'), /not open|closed/i);
const probe = createServer();
await new Promise<void>((accept, reject) => {
  probe.once('error', reject);
  probe.listen(port, '127.0.0.1', accept);
});
await probe[Symbol.asyncDispose]();
process.stdout.write(`${JSON.stringify({ ...report, closed: true, shutdowns })}\n`);
