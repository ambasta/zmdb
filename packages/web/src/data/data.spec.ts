// Tests (#279) for zmdb data-layer integration — RED first (data exports absent).
// Orders end-to-end on node:sqlite: controller injects a repository via DI, body
// validated before persist, typed response. Per packages/web/src/data/SPEC.md.
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { defineSchema, serial, integer, numeric } from '@zmdb/schema-core';
import { defineRepository, type BaseRepository } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import { Container, Inject } from '../di/index.ts';
import { Controller, Get, Post } from '../routing/index.ts';
import { createRouter, type Ctx } from '../pipeline/index.ts';
import { repositoryToken, validateWith } from './index.ts';

const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: integer().notNull(),
  total: numeric().notNull(),
});

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
  db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT, userId INTEGER NOT NULL, total NUMERIC NOT NULL)');
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
    const created = await router.handle({ method: 'POST', path: '/orders', headers: {}, rawBody: { userId: 1, total: 42 } });
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
