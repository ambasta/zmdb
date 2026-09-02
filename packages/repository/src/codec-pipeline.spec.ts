import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  defineSchema,
  serial,
  text,
  bigint,
  boolean,
  timestamp,
  json,
  jsonEnum,
  primaryKey,
  notNull,
} from '@zmdb/schema-core';
import type { CreateDTO, UpdateDTO, WhereDTO } from '@zmdb/schema-core';
import { defineType } from '@zmdb/schema-core/custom-types';
import { describe, it, expect } from 'vitest';

import { sqliteDriver } from './drivers/sqlite.ts';
import { BaseRepository, ValidationError, type Driver } from './index.ts';

const customCodec = defineType<string, string[], string>({
  sqlType: 'text',
  toDb: tags => tags.join(','),
  fromDb: raw => (raw ? raw.split(',') : []),
  toWire: tags => tags.join(','),
  fromWire: raw => (raw ? raw.split(',') : []),
});

const EventSchema = defineSchema('events', {
  id: primaryKey(serial()),
  title: notNull(text()),
  bigintVal: notNull(bigint()),
  isPublished: notNull(boolean()),
  createdAt: notNull(timestamp()),
  payload: notNull(json()),
  status: jsonEnum(['draft', 'published', 'archived']).notNull().defaultTo('draft'),
  tags: { type: 'text' as const, flags: { nullable: false }, codec: customCodec },
});

class EventRepository extends BaseRepository<typeof EventSchema> {
  static override readonly schema = EventSchema;
}

describe('AOT-Validator & Schema Codec Pipeline Integration', () => {
  it('Criterion 1: Read queries return rows decoded into declared entity field types (Date, JSON, bigint, boolean)', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        bigintVal BIGINT NOT NULL,
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
      9007199254740993n,
      1,
      '2026-08-30T10:00:00.000Z',
      '{"key":"value","count":42}',
      'published',
      'news,tech',
    );

    const repo = new EventRepository(sqliteDriver(db), 'sqlite');

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

    const found = await repo.find({ status: 'published' } as WhereDTO<typeof EventSchema>);
    expect(found).toHaveLength(1);
    expect(found[0]?.createdAt).toBeInstanceOf(Date);
  });

  it('Criterion 2: Writes with JSON objects and Date instances execute without driver errors', async () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        bigintVal BIGINT NOT NULL,
        isPublished INTEGER NOT NULL,
        createdAt TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        tags TEXT NOT NULL
      )
    `);
    const repo = new EventRepository(sqliteDriver(db), 'sqlite');

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
    } as CreateDTO<typeof EventSchema>);

    expect(created.id).toBe(1);
    expect(created.createdAt).toBeInstanceOf(Date);
    expect(created.createdAt.toISOString()).toBe('2026-08-30T12:34:56.789Z');
    expect(created.payload).toEqual(payloadObj);
    expect(created.bigintVal).toBe(1234567890123456789n);

    // Update with partial patch containing Date and JSON object
    const updated = await repo.update(1, {
      createdAt: new Date('2026-08-31T00:00:00.000Z'),
      payload: { user: 'alice', permissions: ['read', 'write', 'admin'] },
    } as UpdateDTO<typeof EventSchema>);

    expect(updated?.createdAt.toISOString()).toBe('2026-08-31T00:00:00.000Z');
    expect(updated?.payload).toEqual({ user: 'alice', permissions: ['read', 'write', 'admin'] });
  });

  it('Criterion 3: Invalid write payloads and filter payloads trigger schema validation errors before query compilation', async () => {
    const calls: unknown[] = [];
    const mockDriver: Driver = {
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
      } as unknown as CreateDTO<typeof EventSchema>),
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
      } as unknown as CreateDTO<typeof EventSchema>),
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
      } as unknown as CreateDTO<typeof EventSchema>),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);

    // Filter with unknown column
    await expect(repo.find({ unknownField: 'test' } as unknown as WhereDTO<typeof EventSchema>)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(calls).toHaveLength(0);

    // Filter with invalid value type for known column
    await expect(repo.find({ status: 123 } as unknown as WhereDTO<typeof EventSchema>)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(calls).toHaveLength(0);
  });

  it('Criterion 4: 64-bit integer fields reject standard floating-point and numeric primitives', async () => {
    const calls: unknown[] = [];
    const mockDriver: Driver = {
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
      } as unknown as CreateDTO<typeof EventSchema>),
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
      } as unknown as CreateDTO<typeof EventSchema>),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(calls).toHaveLength(0);
  });

  it('Criterion 5: Repository query compilation contains zero explicit "as any" or "no-explicit-any" suppressions', () => {
    const repoSource = fs.readFileSync(path.join(__dirname, 'index.ts'), 'utf-8');
    expect(repoSource).not.toMatch(/as any/);
    expect(repoSource).not.toMatch(/no-explicit-any/);
  });
});
