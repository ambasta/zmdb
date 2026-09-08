import { jobsExtension, type JobStore, type Queue, type Worker } from '@zmdb/jobs';
import { createMemoryJobStore } from '@zmdb/jobs-sqlite';
import {
  createApp,
  type CreateDTO,
  type Entity,
  type MinLength,
  type PrimaryKey,
  type Serial,
  type Sql,
  type Table,
} from 'zmdb';
import type { ModuleClass } from 'zmdb/app';
import type { BaseRepository } from 'zmdb/orm';

interface Order extends Table<'orders'> {
  readonly id: number & Sql<'integer'> & PrimaryKey & Serial;
  readonly name: string & Sql<'text'> & MinLength<1>;
}

interface Jobs {
  readonly 'order.created': { readonly orderId: number; readonly name: string };
}

declare const queue: Queue<Jobs>;
declare const orders: BaseRepository<Order>;
declare const worker: Worker;
declare const root: ModuleClass;

const input: CreateDTO<Order> = { name: 'first order' };
const entity: Promise<Entity<Order>> = orders.create(input);
void queue.enqueue('order.created', { orderId: 1, name: 'first order' });
const store: JobStore = createMemoryJobStore();
const app = createApp(root, { extensions: [jobsExtension({ workers: [worker] })], graceMs: 1000 });
void app[Symbol.asyncDispose]();
void [entity, store];

// @ts-expect-error A text column cannot receive a numeric value.
void orders.create({ name: 1 });
// @ts-expect-error The create DTO requires the name field.
void orders.create({});
// @ts-expect-error Job payloads keep the declared numeric order identifier.
void queue.enqueue('order.created', { orderId: '1', name: 'first order' });
// @ts-expect-error A declared job requires every payload field.
void queue.enqueue('order.created', { orderId: 1 });
// @ts-expect-error Selecting jobs does not make arbitrary names valid.
void queue.enqueue('order.deleted', { orderId: 1, name: 'first order' });
