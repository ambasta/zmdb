import type { CoreSchema } from '@zmdb/schema-core';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, type Driver } from './index.ts';

// #28: delete + pre/post lifecycle hooks.

const UserSchema = {
  table: 'users',
  columns: {
    id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    email: { type: 'text', flags: { nullable: false } },
  },
  primaryKey: ['id'],
  references: [],
} as unknown as CoreSchema<'users'>;

function fakeDriver(rows: Record<string, unknown>[] = []): Driver {
  return { execute: vi.fn(async () => rows) };
}

describe('delete', () => {
  it('reports true when a row was deleted', async () => {
    class Repo extends BaseRepository<typeof UserSchema> {
      static override readonly schema = UserSchema;
    }
    const repo = new Repo(fakeDriver([{ id: 1 }]));
    expect(await repo.delete(1)).toBe(true);
  });

  it('reports false when nothing was deleted', async () => {
    class Repo extends BaseRepository<typeof UserSchema> {
      static override readonly schema = UserSchema;
    }
    const repo = new Repo(fakeDriver([]));
    expect(await repo.delete(999)).toBe(false);
  });
});

describe('lifecycle hooks', () => {
  it('fires preInsert then postInsert around create, in order', async () => {
    const order: string[] = [];
    class Repo extends BaseRepository<typeof UserSchema> {
      static override readonly schema = UserSchema;
      protected override preInsert() {
        order.push('preInsert');
      }
      protected override postInsert() {
        order.push('postInsert');
      }
    }
    const repo = new Repo(fakeDriver([{ id: 1, email: 'a@b.com' }]));
    await repo.create({ email: 'a@b.com' });
    expect(order).toEqual(['preInsert', 'postInsert']);
  });

  it('fires preDelete before deleting', async () => {
    const order: string[] = [];
    class Repo extends BaseRepository<typeof UserSchema> {
      static override readonly schema = UserSchema;
      protected override preDelete() {
        order.push('preDelete');
      }
    }
    const repo = new Repo(fakeDriver([{ id: 1 }]));
    await repo.delete(1);
    expect(order).toEqual(['preDelete']);
  });
});
