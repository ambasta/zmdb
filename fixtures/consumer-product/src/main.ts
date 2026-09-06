import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

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
} from 'zmdb';
import { loadConfig } from 'zmdb/config';
import { bodyText } from 'zmdb/web';

import type { Order } from './schema.js';

interface EmbeddedMigration {
  readonly version: number;
  readonly name: string;
  readonly up: string;
  readonly checksum: string;
}

interface EmbeddedConnection {
  exec(sql: string): Promise<void>;
  run(sql: string, params: readonly (string | number | null)[]): Promise<void>;
  rows(sql: string, params: readonly (string | number | null)[]): Promise<readonly Record<string, unknown>[]>;
}

function connection(database: DatabaseSync): EmbeddedConnection {
  return {
    async exec(sql) {
      database.exec(sql);
    },
    async run(sql, params) {
      database.prepare(sql).run(...params);
    },
    async rows(sql, params) {
      return database.prepare(sql).all(...params);
    },
  };
}

async function applyEmbeddedMigrations(
  module: unknown,
  database: EmbeddedConnection,
  migrations: readonly EmbeddedMigration[],
): Promise<readonly number[]> {
  if (typeof module !== 'object' || module === null) throw new TypeError('zmdb/migrations did not load');
  const runEmbedded = Reflect.get(module, 'runEmbedded');
  if (typeof runEmbedded !== 'function') throw new TypeError('zmdb/migrations does not export runEmbedded');
  const applied: unknown = await Reflect.apply(runEmbedded, module, [database, migrations]);
  if (!Array.isArray(applied) || applied.some(version => typeof version !== 'number')) {
    throw new TypeError('runEmbedded did not return migration versions');
  }
  return applied;
}

function applyDecorator(decorator: unknown, ...args: readonly unknown[]): void {
  if (typeof decorator !== 'function') throw new TypeError('web decorator is not callable');
  Reflect.apply(decorator, undefined, args);
}

const loaded = await loadConfig({ cwd: process.cwd() });
const databasePath = process.env.ZMDB_PRODUCT_DATABASE;
if (databasePath === undefined) throw new Error('ZMDB_PRODUCT_DATABASE is required');

const migrationSource = await readFile(
  new URL('../migrations/20260905000100_create_orders.sql', import.meta.url),
  'utf8',
);
const up = migrationSource.split('-- zmdb:down')[0]?.replace('-- zmdb:up', '').trim();
if (up === undefined || up.length === 0) throw new Error('fixture migration has no up section');

// A variable keeps this a runtime package-boundary probe instead of letting the
// bundler fold the migration facade into the application bundle.
const migrationsEntry: string = 'zmdb/migrations';
const migrationModule: unknown = await import(migrationsEntry);
const database = new DatabaseSync(databasePath);
const applied = await applyEmbeddedMigrations(migrationModule, connection(database), [
  {
    version: 20260905000100,
    name: 'create_orders',
    up,
    checksum: 'sha256:consumer-product-create-orders-v1',
  },
]);

const configuredDriver = await loaded.driver?.();
if (configuredDriver === undefined) throw new Error('canonical config did not provide the SQLite driver');
const OrderSchema = schemaOf<Order>();
const orders = defineRepository(OrderSchema, configuredDriver, { dialect: 'sqlite' });

class OrdersController {
  async create(ctx: Ctx<Record<never, string>, CreateDTO<Order>>) {
    return orders.create(assert<CreateDTO<Order>>(ctx.body));
  }
}

const controllerMetadata: DecoratorMetadata = Object.create(null);
applyDecorator(Post(), OrdersController.prototype.create, {
  kind: 'method',
  name: 'create',
  metadata: controllerMetadata,
});
applyDecorator(Controller('/orders'), OrdersController, {
  kind: 'class',
  name: 'OrdersController',
  metadata: controllerMetadata,
});
Object.defineProperty(OrdersController, Symbol.metadata, { value: controllerMetadata });

class ProductModule {
  readonly product = 'consumer-product';
}

const moduleMetadata: DecoratorMetadata = Object.create(null);
applyDecorator(Module({ controllers: [OrdersController] }), ProductModule, {
  kind: 'class',
  name: 'ProductModule',
  metadata: moduleMetadata,
});
Object.defineProperty(ProductModule, Symbol.metadata, { value: moduleMetadata });

const app = createApp(ProductModule);
const invalid = await app.fetch(
  new Request('http://product.test/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '' }),
  }),
);
const afterInvalid = database.prepare('SELECT COUNT(*) AS count FROM orders').get();

const valid = await app.fetch(
  new Request('http://product.test/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'first order' }),
  }),
);
const created = JSON.parse(
  await bodyText({ status: valid.status, headers: {}, body: { kind: 'text', value: await valid.text() } }),
);
const stored = database.prepare('SELECT id, name FROM orders ORDER BY id').all();
const ledger = database.prepare('SELECT version, name, checksum FROM _zmdb_migrations ORDER BY version').all();

await app[Symbol.asyncDispose]();
database.close();

if (invalid.status === 200) throw new Error('invalid request was accepted');
if (valid.status !== 200) throw new Error(`valid request returned ${String(valid.status)}`);
if (stored.length !== 1) throw new Error(`expected one stored row, received ${String(stored.length)}`);

process.stdout.write(
  `${JSON.stringify({
    config: loaded.configPath,
    applied,
    invalidStatus: invalid.status,
    afterInvalid,
    created,
    ledger,
    stored,
  })}\n`,
);
