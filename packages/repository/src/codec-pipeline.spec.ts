import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/compiler/testing';
import type { CreateDTO, TaggedSchema, UpdateDTO, WhereDTO } from '@zmdb/schema-core';
import { defineType } from '@zmdb/schema-core/custom-types';
import type { ColumnIR } from '@zmdb/schema-core/ir';
import type { Codec, HasDefault, PrimaryKey, Serial, Sql, Table, WireAs } from '@zmdb/schema-core/tags';
import { sqlite, sqliteDriver } from '@zmdb/sqlite';
import { describe, it, expect } from 'vitest';

import { BaseRepository, ValidationError, type Driver } from './index.js';

export const customCodec = defineType<string, string[], string>({
  sqlType: 'text',
  toDb: tags => tags.join(','),
  fromDb: raw => (typeof raw === 'string' && raw ? raw.split(',') : []),
  toWire: tags => tags.join(','),
  fromWire: raw => (typeof raw === 'string' && raw ? raw.split(',') : []),
});

export interface EventPayload {
  key?: string;
  count?: number;
  user?: string;
  permissions?: string[];
  a?: number;
}

export interface EventTable extends Table<'events'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  title: string & Sql<'text'>;
  bigintVal: bigint & Sql<'bigint'>;
  isPublished: boolean & Sql<'boolean'>;
  createdAt: Date & Sql<'timestamp'>;
  payload: EventPayload & Sql<'json'>;
  status: ('draft' | 'published' | 'archived') & Sql<'jsonEnum'> & HasDefault;
  tags: string[] & Sql<'text'> & Codec<'customCodec'> & WireAs<string>;
}

const { EventTable: baseSchema } = schemasFrom<{ EventTable: EventTable }>(import.meta.url, ['EventTable']);

const tagsCol = baseSchema.columns.tags!;

export const EventSchema: TaggedSchema<EventTable> = {
  ...baseSchema,
  columns: {
    ...baseSchema.columns,
    tags: {
      ...tagsCol,
      codec: customCodec,
    },
  },
  ir: {
    ...baseSchema.ir,
    columns: baseSchema.ir.columns.map(c => (c.name === 'tags' ? { ...c, codec: 'customCodec' } : c)) as ColumnIR[],
  },
};

class EventRepository extends BaseRepository<EventTable> {
  static override readonly schema = EventSchema;
}

describe('AOT-Validator & Schema Codec Pipeline Integration', () => {
  it('Criterion 1: Read queries return rows decoded into declared entity field types (Date, JSON, bigint, boolean)', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        bigintVal TEXT NOT NULL,
        isPublished INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        tags TEXT NOT NULL
      )
    `);

    // Insert raw DB driver output primitives
    db.prepare(`
      INSERT INTO events (title, bigintVal, isPublished, createdAt, payload, status, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'Launch Event',
      '9007199254740993',
      1,
      '2026-08-30T10:00:00.000Z',
      '{"key":"value","count":42}',
      'published',
      'news,tech',
    );

    const repo = new EventRepository(sqliteDriver(db));

    const item = await repo.findById(1);
    expect(item).toBeDefined();
    expect(item?.createdAt).toBeInstanceOf(Date);
    expect(item?.createdAt.toISOString()).toBe('2026-08-30T10:00:00.000Z');
    expect(item?.payload).toEqual({ key: 'value', count: 42 });
    expect(item?.bigintVal).toBe(9007199254740993n);
    expect(typeof item?.bigintVal).toBe('bigint');
    expect(item?.isPublished).toBe(true);
    expect(item?.tags).toEqual(['news', 'tech']);

    const all = await repo.findAll();
    expect(all).toHaveLength(1);
    expect(all[0]?.createdAt).toBeInstanceOf(Date);
    expect(all[0]?.payload).toEqual({ key: 'value', count: 42 });

    const found = await repo.find({ status: 'published' } as WhereDTO<EventTable>);
    expect(found).toHaveLength(1);
    expect(found[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('Criterion 2: Writes with JSON objects and Date instances execute without driver errors', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        bigintVal TEXT NOT NULL,
        isPublished INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        tags TEXT NOT NULL
      )
    `);
    const repo = new EventRepository(sqliteDriver(db));

    const now = new Date('2026-08-30T12:34:56.789Z');
    const payloadObj = { user: 'alice', permissions: ['read', 'write'] };

    const created = await repo.create({
      title: 'New Conference',
      bigintVal: 1234567890123456789n,
      isPublished: true,
      createdAt: now,
      payload: payloadObj,
      status: 'published',
      tags: ['conf', '2026'] as unknown as string[],
    } as CreateDTO<EventTable>);

    expect(created.id).toBe(1);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt.toISOString()).toBe('2026-08-30T12:34:56.789Z');
    expect(created.payload).toEqual(payloadObj);
    expect(created.bigintVal).toBe(1234567890123456789n);

    // Update with partial patch containing Date and JSON object
    const updated = await repo.update(1, {
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
      payload: { user: 'alice', permissions: ['read', 'write', 'admin'] },
    } as UpdateDTO<EventTable>);

    expect(updated?.createdAt.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(updated?.payload).toEqual({ user: 'alice', permissions: ['read', 'write', 'admin'] });
  });

  it('Criterion 3: Invalid write payloads and filter payloads trigger schema validation errors before query compilation', async () => {
    const calls: unknown[] = [];
    const mockDriver: Driver = {
      dialect: sqlite,
      execute: async q => {
        calls.push(q);
        return [];
      },
    };
    const repo = new EventRepository(mockDriver);

    // Missing required field
    await expect(
      repo.create({
        title: 'Missing fields',
      } as unknown as CreateDTO<EventTable>),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);

    // Invalid timestamp date string
    await expect(
      repo.create({
        title: 'Bad Date',
        bigintVal: 100n,
        isPublished: true,
        createdAt: 'not-a-valid-date',
        payload: { a: 1 },
      } as unknown as CreateDTO<EventTable>),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);

    // Invalid JSON string
    await expect(
      repo.create({
        title: 'Bad JSON',
        bigintVal: 100n,
        isPublished: true,
        createdAt: new Date(),
        payload: '{malformed json:',
      } as unknown as CreateDTO<EventTable>),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);

    // Filter with unknown column
    await expect(repo.find({ unknownField: 'test' } as unknown as WhereDTO<EventTable>)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(calls).toHaveLength(0);

    // Filter with invalid value type for known column
    await expect(repo.find({ status: 123 } as unknown as WhereDTO<EventTable>)).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('Criterion 4: 64-bit integer fields reject standard floating-point and numeric primitives', async () => {
    const calls: unknown[] = [];
    const mockDriver: Driver = {
      dialect: sqlite,
      execute: async q => {
        calls.push(q);
        return [];
      },
    };
    const repo = new EventRepository(mockDriver);

    // Float number passed for bigint
    await expect(
      repo.create({
        title: 'Float bigint',
        bigintVal: 123.45,
        isPublished: true,
        createdAt: new Date(),
        payload: {},
      } as unknown as CreateDTO<EventTable>),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);

    // Standard number primitive passed for bigint
    await expect(
      repo.create({
        title: 'Number bigint',
        bigintVal: 12345,
        isPublished: true,
        createdAt: new Date(),
        payload: {},
      } as unknown as CreateDTO<EventTable>),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('Criterion 5: Repository query compilation contains zero explicit "as any" or "no-explicit-any" suppressions', () => {
    const repoSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf-8');
    expect(repoSource).not.toMatch(/as any/);
    expect(repoSource).not.toMatch(/no-explicit-any/);
  });
});
