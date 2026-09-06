import { DatabaseSync } from 'node:sqlite';

import { assert } from 'zmdb';
import { schemaFromIR, type SchemaIR } from 'zmdb/ir';
import { BaseRepository } from 'zmdb/orm';
import { sqliteDriver } from 'zmdb/sqlite';
import type { PrimaryKey, Sql, Table } from 'zmdb/tags';
import { Controller, createApp, Get, Module } from 'zmdb/web';

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
const orders = new Orders(sqliteDriver(database));
const validatedName = assert<string>('packed default', {
  kind: 'scalar',
  scalar: 'string',
  constraints: { minLength: 1 },
});
await orders.create({ id: 1, name: validatedName });

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
try {
  await application.init();
  const response = await application.fetch(new Request('http://packed.test/orders'));
  const body: unknown = await response.json();
  if (response.status !== 200) throw new Error(`packed default returned ${String(response.status)}`);
  if (!Array.isArray(body) || body.length !== 1) {
    throw new Error(`packed default returned ${JSON.stringify(body)}`);
  }
  process.stdout.write(
    `${JSON.stringify({
      status: response.status,
      rows: body,
      validation: validatedName,
    })}\n`,
  );
} finally {
  await application[Symbol.asyncDispose]();
  database.close();
}
