import check from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { assert, type CreateDTO } from 'zmdb';
import { schemaFromIR, type SchemaIR } from 'zmdb/ir';
import { BaseRepository, type Driver } from 'zmdb/orm';
import type { PrimaryKey, Sql, Table } from 'zmdb/tags';
import { Controller, createApp, Get, Module } from 'zmdb/web';

import { consumerDialect } from './dialect.js';

interface Order extends Table<'orders'> {
  readonly id: number & Sql<'integer'> & PrimaryKey;
  readonly name: string & Sql<'text'>;
}

const ORDER_IR: SchemaIR = {
  table: 'orders',
  physicalTable: 'orders',
  columns: [
    {
      name: 'id',
      physicalName: 'id',
      sql: 'integer',
      nullable: false,
      primaryKey: true,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: {},
      rules: [],
    },
    {
      name: 'name',
      physicalName: 'name',
      sql: 'text',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: false,
      hasDefault: false,
      sensitive: false,
      constraints: { minLength: 1 },
      rules: [],
    },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

class Orders extends BaseRepository<Order> {
  static override readonly schema = schemaFromIR(ORDER_IR);
}

const database = new DatabaseSync(':memory:');
database.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
const statements: string[] = [];
const driver: Driver = {
  dialect: consumerDialect,
  async execute(query, options) {
    options?.signal?.throwIfAborted();
    statements.push(query.text);
    const parameters: SQLInputValue[] = query.parameters.map(value => {
      if (value === null || typeof value === 'string' || typeof value === 'number') return value;
      throw new TypeError('fixture accepts only null, string, and number SQL parameters');
    });
    const statement = database.prepare(query.text);
    if (statement.columns().length > 0) return statement.all(...parameters);
    statement.run(...parameters);
    return [];
  },
};
const orders = new Orders(driver);
check.throws(() => assert<string>('', { kind: 'scalar', scalar: 'string', constraints: { minLength: 1 } }));
const validatedName = assert<string>('packed default', {
  kind: 'scalar',
  scalar: 'string',
  constraints: { minLength: 1 },
});
const input: CreateDTO<Order> = { id: 1, name: validatedName };
await orders.create(input);

@Controller('/orders')
class OrdersController {
  @Get()
  list() {
    return orders.findAll();
  }
}

@Module({ controllers: [OrdersController] })
class DefaultApplication {}

const application = createApp(DefaultApplication);
const server = createServer((request, response) => {
  void application
    .fetch(new Request(`http://127.0.0.1${request.url ?? '/'}`))
    .then(async result => {
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(await result.text());
    })
    .catch(error => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
});
try {
  await application.init();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('loopback listener has no TCP address');
  const response = await fetch(`http://127.0.0.1:${address.port}/orders`, { signal: AbortSignal.timeout(5000) });
  const body: unknown = await response.json();
  if (response.status !== 200) throw new Error(`packed default returned ${String(response.status)}`);
  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error(`packed default returned ${JSON.stringify(body)}`);
  }
  check.deepEqual(body, [{ id: 1, name: 'packed default' }]);
  check.equal(statements.length, 2);
  check.match(statements[0] ?? '', /^INSERT/);
  check.match(statements[1] ?? '', /^SELECT/);
  check.deepEqual(
    database
      .prepare('SELECT id, name FROM orders')
      .all()
      .map(row => ({ ...row })),
    body,
  );
  process.stdout.write(
    `${JSON.stringify({
      journey: 'default-product',
      transport: 'loopback-http',
      status: response.status,
      rows: body,
      validation: validatedName,
    })}\n`,
  );
} finally {
  server.closeAllConnections();
  await new Promise<void>((complete, reject) =>
    server.close(error => (error === undefined ? complete() : reject(error))),
  );
  await application[Symbol.asyncDispose]();
  database.close();
}
