import { defineRepository, schemaOf, type CreateDTO, type Driver, type Entity } from '@zmdb/core';

import type { OrdersController } from './src/main.js';
import type { Order } from './src/schema.js';

declare const driver: Driver;
const orders = defineRepository(schemaOf<Order>(), driver);
const dto: CreateDTO<Order> = { name: 'typed order' };
const created: Promise<Entity<Order>> = orders.create(dto);
const found: Promise<Entity<Order> | undefined> = orders.findOne({ id: 1 });
const updated: Promise<Entity<Order> | undefined> = orders.update(1, { name: 'updated' });
const deleted: Promise<boolean> = orders.delete(1);
// @ts-expect-error the declared text column refuses numbers at the public ORM boundary
orders.create({ name: 42 });
// @ts-expect-error public primary-key inference keeps the numeric key
orders.delete('1');
// @ts-expect-error update patches preserve declared text-column types
orders.update(1, { name: 42 });
// @ts-expect-error DTOs retain their required name field
const missing: CreateDTO<Order> = {};

declare const controller: OrdersController;
type CreateContext = Parameters<OrdersController['create']>[0];
declare const context: CreateContext;
const createdByController: Promise<Entity<Order>> = controller.create(context);
const name: string = context.body.name;
// @ts-expect-error HTTP DTO property shape must survive the public facade
const numericName: number = context.body.name;
void [created, found, updated, deleted, missing, createdByController, name, numericName];
