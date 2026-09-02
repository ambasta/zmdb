import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import { defineRepository, type BaseRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
// Tests (#279) for zmdb data-layer integration — RED first (data exports absent).
// Orders end-to-end on node:sqlite: controller injects a repository via DI, body
// validated before persist, typed response. Per packages/web/src/data/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Container, Inject } from '../di/index.ts';
import { createRouter, type Ctx } from '../pipeline/index.ts';
import { Controller, Get, Post } from '../routing/index.ts';
import { repositoryToken, validateWith, wireDecoder, wireEncoder } from './index.ts';

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  userId: number & Sql<'integer'>;
  total: number & Sql<'numeric'>;
}

const OrderRepoToken = repositoryToken<typeof OrderSchema>('OrderRepo');

function isCreateOrder(raw: unknown): { userId: number; total: number } {
  const o = Object(raw);
  if (typeof Reflect.get(o, 'userId') !== 'number' || typeof Reflect.get(o, 'total') !== 'number') {
    throw new Error('userId and total are required numbers');
  }
  return { userId: Reflect.get(o, 'userId'), total: Reflect.get(o, 'total') };
}

@Controller('/orders')
class OrdersController {
  @Inject(OrderRepoToken)
  repo!: BaseRepository<typeof OrderSchema>;

  @Post()
  async create(ctx: Ctx<Record<never, string>, { userId: number; total: number }>) {
    return this.repo.create(ctx.body);
  }

  @Get('/:id')
  async get(ctx: Ctx<{ id: string }>) {
    return this.repo.findById(Number(ctx.params.id));
  }
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(
    'CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total NUMERIC NOT NULL)',
  );
  const repo = defineRepository(OrderSchema, sqliteDriver(db), { dialect: 'sqlite' });
  const container = new Container();
  container.register(OrderRepoToken, repo);
  const controller = container.build(OrdersController);
  const router = createRouter();
  router.register(controller, { create: { validateBody: validateWith(isCreateOrder) } });
  return router;
}

describe('@zmdb/web data: Orders end-to-end (node:sqlite)', () => {
  it('creates then reads an order', async () => {
    const router = setup();
    const created = await router.handle({
      method: 'POST',
      path: '/orders',
      headers: {},
      rawBody: { userId: 1, total: 42 },
    });
    expect(created.status).toBe(200);
    const order = JSON.parse(created.body);
    expect(order.userId).toBe(1);

    const got = await router.handle({ method: 'GET', path: `/orders/${order.id}`, headers: {} });
    expect(got.status).toBe(200);
    expect(JSON.parse(got.body).total).toBe(42);
  });

  it('rejects an invalid body without persisting (400)', async () => {
    const router = setup();
    const res = await router.handle({ method: 'POST', path: '/orders', headers: {}, rawBody: { userId: 'x' } });
    expect(res.status).toBe(400);
  });
});

// The wire↔app crossing at the HTTP boundary (plan D3). JSON has no date and no bigint;
// the app layer, the repository and the DDL all do. These two functions are the only place
// the two forms meet, and the test asserts both directions plus what neither does.
export interface Event extends Table<'events'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  at: Date & Sql<'timestamp'>;
  seq: bigint & Sql<'bigint'>;
}

// One call for both: opening the project is what costs, and reflecting a second interface off
// the session already open is about 3ms.
const { Order: OrderSchema, Event: EventSchema } = schemasFrom<{ Order: Order; Event: Event }>(import.meta.url, [
  'Order',
  'Event',
]);

const EventRepoToken = repositoryToken<typeof EventSchema>('EventRepo');

const ISO = '2026-01-01T12:30:00.000Z';

interface CreateEvent {
  name: string;
  at: Date;
  seq: bigint;
}
function assertCreateEvent(raw: unknown): CreateEvent {
  const o = Object(raw);
  const [name, at, seq] = [Reflect.get(o, 'name'), Reflect.get(o, 'at'), Reflect.get(o, 'seq')];
  if (typeof name !== 'string') throw new Error('expected string');
  if (!(at instanceof Date)) throw new Error('expected Date');
  if (typeof seq !== 'bigint') throw new Error('expected bigint');
  return { name, at, seq };
}

describe('@zmdb/web data: wireDecoder / wireEncoder', () => {
  it('decodes the two types JSON cannot carry, and copies the rest through', () => {
    const decode = wireDecoder(EventSchema, 'create');
    expect(decode({ name: 'launch', at: ISO, seq: '9007199254740993' })).toEqual({
      name: 'launch',
      at: new Date(ISO),
      seq: 9007199254740993n,
    });
  });

  it('converts and rejects nothing, leaving the validator to report what it could not convert', () => {
    const decode = wireDecoder(EventSchema, 'create');
    // Not `new Date('nonsense')`: an Invalid Date is an `instanceof Date`, so a decode that
    // produced one would smuggle a bad value past a validator that checks the app type.
    expect(decode({ at: 'nonsense', seq: '0x10' })).toEqual({ at: 'nonsense', seq: '0x10' });
    expect(decode({ nope: 1 })).toEqual({ nope: 1 });
    expect(decode('a string body')).toBe('a string body');
  });

  it('encodes a row back to the forms the published document describes', () => {
    const encode = wireEncoder(EventSchema);
    expect(encode({ id: 1, name: 'launch', at: new Date(ISO), seq: 9007199254740993n })).toEqual({
      id: 1,
      name: 'launch',
      at: ISO,
      seq: '9007199254740993',
    });
  });

  it('encodes a list, because a findMany result is one', () => {
    const encode = wireEncoder(EventSchema);
    expect(
      encode([
        { at: new Date(ISO), seq: 1n },
        { at: new Date(ISO), seq: 2n },
      ]),
    ).toEqual([
      { at: ISO, seq: '1' },
      { at: ISO, seq: '2' },
    ]);
  });

  it('produces a response JSON.stringify can actually serialize', () => {
    const row = { id: 1, at: new Date(ISO), seq: 1n };
    // A bigint does not survive JSON at all, so this is not a formatting nicety.
    expect(() => JSON.stringify(row)).toThrow(TypeError);
    expect(JSON.stringify(wireEncoder(EventSchema)(row))).toBe(`{"id":1,"at":"${ISO}","seq":"1"}`);
  });
});

@Controller('/events')
class EventsController {
  @Inject(EventRepoToken)
  repo!: BaseRepository<typeof EventSchema>;

  @Post()
  async create(ctx: Ctx<Record<never, string>, CreateEvent>) {
    return wireEncoder(EventSchema)(await this.repo.create(ctx.body));
  }
}

describe('@zmdb/web data: an ISO body persisted and returned (node:sqlite)', () => {
  it('crosses all three layers in one request', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, at TEXT NOT NULL, seq INTEGER NOT NULL)',
    );
    const container = new Container();
    container.register(EventRepoToken, defineRepository(EventSchema, sqliteDriver(db), { dialect: 'sqlite' }));
    const router = createRouter();
    const decode = wireDecoder(EventSchema, 'create');
    router.register(container.build(EventsController), {
      create: { validateBody: validateWith(raw => assertCreateEvent(decode(raw))) },
    });

    const res = await router.handle({
      method: 'POST',
      path: '/events',
      headers: {},
      rawBody: { name: 'launch', at: ISO, seq: '7' },
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ name: 'launch', at: ISO, seq: '7' });
    // And the cell holds the same instant in the form the DDL declared.
    expect(db.prepare('SELECT at, seq FROM events').all()).toEqual([{ at: ISO, seq: 7 }]);
  });

  it('rejects a body whose date is not one, without persisting (400)', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(
      'CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, at TEXT NOT NULL, seq INTEGER NOT NULL)',
    );
    const container = new Container();
    container.register(EventRepoToken, defineRepository(EventSchema, sqliteDriver(db), { dialect: 'sqlite' }));
    const router = createRouter();
    const decode = wireDecoder(EventSchema, 'create');
    router.register(container.build(EventsController), {
      create: { validateBody: validateWith(raw => assertCreateEvent(decode(raw))) },
    });

    const res = await router.handle({
      method: 'POST',
      path: '/events',
      headers: {},
      rawBody: { name: 'launch', at: 'nonsense', seq: '7' },
    });

    expect(res.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM events').all()).toEqual([{ n: 0 }]);
  });
});
