import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect } from 'vitest';

import { BaseRepository, defineRepository } from './index.js';

export interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'text'>;
  role: 'admin' | 'user';
  active: boolean & Sql<'boolean'> & HasDefault;
  createdAt: Date & Sql<'timestamp'>;
}

const { User: UserSchema } = schemasFrom<{ User: User }>(import.meta.url, ['User']);

describe('BaseRepository query compiler schema bound forwarding', () => {
  it('forwards schema bound S to this.query on repository instances', () => {
    const mockDriver = {
      execute: async () => [{ id: 1, email: 'a@b.com', role: 'admin', active: true }],
    };
    const repo = defineRepository(UserSchema, mockDriver);

    // Call query compiler via repo.query with schema bounds
    const q = repo.query.selectFrom('users').select(['id', 'email', 'role']).where('role', '=', 'admin').compile();

    expect(q.text).toBe('SELECT "id", "email", "role" FROM "users" WHERE "role" = $1');
    expect(q.parameters).toEqual(['admin']);
  });

  it('subclasses of BaseRepository inherit type-bounded this.query', () => {
    class UserRepository extends BaseRepository<User> {
      static override readonly schema = UserSchema;

      findActiveAdmins() {
        return this.query.selectFrom('users').where('role', '=', 'admin').andWhere('active', '=', true).compile();
      }
    }

    const mockDriver = { execute: async () => [] };
    const repo = new UserRepository(mockDriver);
    const q = repo.findActiveAdmins();

    expect(q.text).toBe('SELECT * FROM "users" WHERE "role" = $1 AND "active" = $2');
    expect(q.parameters).toEqual(['admin', true]);
  });

  it('type-level verification for repository query compiler bounds', () => {
    const mockDriver = { execute: async () => [] };
    const repo = defineRepository(UserSchema, mockDriver);

    // @ts-expect-error - non-existent column name
    repo.query.selectFrom('users').select(['invalid_column']);

    // @ts-expect-error - mismatched clause value
    repo.query.selectFrom('users').where('email', '=', 123);

    // @ts-expect-error - mismatched timestamp value: createdAt expects Date, string is rejected
    repo.query.selectFrom('users').where('createdAt', '=', '2026-01-01');
  });
});
