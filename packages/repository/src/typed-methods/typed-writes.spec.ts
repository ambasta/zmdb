import { schemasFrom } from '@zmdb/compiler/testing';
import { inc, UnsupportedFeatureError, type CompiledQuery } from '@zmdb/query-compiler';
import { defineType } from '@zmdb/schema-core';
import type { CreateDTO, UpdateDTO, TaggedSchema, DeclaredTable } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, ValidationError, defineRepository } from '../index.js';
import { officialDialects } from '../testing/official-dialects.fixture.js';
import { Users, type User } from './typed-methods.fixture.js';

/** The payload type of the `settings` column, named separately because the tests below
 *  cast to it when they hand the column a primitive on purpose. */
export interface Config {
  theme: string;
}

/** Three json columns: a typed object, a typed array, and a nullable one. */
export interface ConfigRow extends Table<'configs'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  settings: Config & Sql<'json'>;
  tags: string[] & Sql<'json'>;
  optionalNotes: ({ note: string } & Sql<'json'>) | null;
}

const { ConfigRow: ConfigSchema } = schemasFrom<{ ConfigRow: ConfigRow }>(import.meta.url, ['ConfigRow']);

// The DTO signatures these tests exercise are asserted in
// `typed-methods.type-test.ts` — this file covers validation and the driver calls.
describe('typed create/update (#206)', () => {
  it('create validates then inserts, returning the row', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 30, role: 'user' }]);
    const repo = new Users({ dialect: officialDialects.postgres, execute });
    const dto: CreateDTO<User> = { email: 'a@b.com', age: 30 };
    const out = await repo.create(dto);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out.id).toBe(1);
  });

  it('create throws ValidationError and does NOT call the driver on invalid input', async () => {
    const execute = vi.fn(async () => []);
    const repo = new Users({ dialect: officialDialects.postgres, execute });
    // age missing (required, no default) → invalid. The cast is the point of the
    // test: it models untrusted input reaching a typed API at runtime, which is
    // what the validator has to catch. The compile-time half is asserted in
    // `typed-methods.type-test.ts`.
    await expect(repo.create({ email: 'a@b.com' } as unknown as CreateDTO<User>)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('update validates a partial patch then updates', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 31, role: 'admin' }]);
    const repo = new Users({ dialect: officialDialects.postgres, execute });
    const patch: UpdateDTO<User> = { role: 'admin' };
    const out = await repo.update(1, patch);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out?.role).toBe('admin');
  });
  it('update strips explicit undefined properties before payload validation', async () => {
    const execute = vi.fn(async (_q: unknown) => [{ id: 1, email: 'a@b.com', age: 32, role: 'user' }]);
    const repo = new Users({ dialect: officialDialects.postgres, execute });
    // `UpdateDTO<User>` no longer admits `{ email: undefined }` — `{}` already means "leave it
    // alone" and `{ email: null }` means "set it to NULL", so the type offers one spelling of
    // each. The runtime still has to cope, because this is what a parsed request body looks
    // like, so the patch arrives here the way it arrives in production: past the type system.
    const body: unknown = { age: 32, email: undefined };
    const out = await repo.update(1, body as UpdateDTO<User>);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out?.age).toBe(32);
    // Check compiled SQL parameter only contains age, not email
    const query = execute.mock.calls[0]?.[0] as { text: string; parameters: unknown[] } | undefined;
    expect(query?.text).toContain('UPDATE "users" SET "age" = $1 WHERE "id" = $2');
    expect(query?.parameters).toEqual([32, 1]);
  });

  describe('custom column validation and write transformation', () => {
    interface Money {
      amount: number;
      currency: string;
    }

    const MoneyType = defineType<string, Money, string>({
      sqlType: 'VARCHAR(50)',
      toDb: m => {
        if (!['USD', 'EUR', 'GBP'].includes(m.currency)) {
          throw new Error(`unsupported currency: ${m.currency}`);
        }
        return `${m.amount}:${m.currency}`;
      },
      fromDb: (raw: string) => {
        const [amount, currency] = raw.split(':');
        return { amount: Number(amount), currency: currency ?? 'USD' };
      },
      toWire: m => `${m.amount}:${m.currency}`,
      fromWire: (raw: string) => {
        const [amount, currency] = raw.split(':');
        return { amount: Number(amount), currency: currency ?? 'USD' };
      },
      validate: m => {
        if (typeof m !== 'object' || m === null) return 'money payload must be an object';
        const money = m as Partial<Money>;
        if (typeof money.amount !== 'number' || money.amount <= 0) return 'money amount must be positive';
        return true;
      },
    });

    const OrderSchema = {
      table: 'orders',
      columns: {
        id: { type: 'serial', flags: { nullable: false, autoIncrement: true, hasDefault: true, primaryKey: true } },
        total: { type: 'text', flags: { nullable: false }, customType: MoneyType },
        discount: { type: 'text', flags: { nullable: true }, customType: MoneyType },
      },
      primaryKey: ['id'],
      references: [],
      ir: {
        table: 'orders',
        columns: [
          {
            name: 'id',
            physicalName: 'id',
            sql: 'serial',
            nullable: false,
            primaryKey: true,
            serial: true,
            unique: false,
            hasDefault: true,
            sensitive: false,
            constraints: {},
            rules: [],
          },
          {
            name: 'total',
            physicalName: 'total',
            sql: 'text',
            codec: 'Money',
            payload: { kind: 'unknown' },
            nullable: false,
            primaryKey: false,
            serial: false,
            unique: false,
            hasDefault: false,
            sensitive: false,
            constraints: {},
            rules: [],
          },
          {
            name: 'discount',
            physicalName: 'discount',
            sql: 'text',
            codec: 'Money',
            payload: { kind: 'unknown' },
            nullable: true,
            primaryKey: false,
            serial: false,
            unique: false,
            hasDefault: false,
            sensitive: false,
            constraints: {},
            rules: [],
          },
        ],
        primaryKey: ['id'],
        relations: [],
      },
    } as unknown as TaggedSchema<DeclaredTable>;

    it('validates custom-typed domain objects and encodes them prior to SQL compilation', async () => {
      const execute = vi.fn(async (_q: CompiledQuery) => [{ id: 1, total: '100:USD', discount: null }]);
      const repo = defineRepository(OrderSchema, { dialect: officialDialects.postgres, execute });

      await repo.create({
        total: { amount: 100, currency: 'USD' },
        discount: null,
      });

      expect(execute).toHaveBeenCalledTimes(1);
      const query = execute.mock.calls[0]![0];
      expect(query.parameters).toContain('100:USD');
      expect(query.text).toContain('INSERT INTO "orders"');

      execute.mockResolvedValueOnce([{ id: 1, total: '100:USD', discount: '10:USD' }] as never);
      await repo.update(1, {
        discount: { amount: 10, currency: 'USD' },
      });

      const updateQuery = execute.mock.calls[1]![0];
      expect(updateQuery.parameters).toContain('10:USD');
      expect(updateQuery.text).toContain('UPDATE "orders" SET "discount" = $1');
    });

    it('rejects custom-typed write payloads that fail custom validation rules', async () => {
      const execute = vi.fn(async () => []);
      const repo = defineRepository(OrderSchema, { dialect: officialDialects.postgres, execute });

      // Validation returns error message ("money amount must be positive")
      await expect(
        repo.create({
          total: { amount: -50, currency: 'USD' },
          discount: null,
        }),
      ).rejects.toThrowError(/money amount must be positive/);

      expect(execute).not.toHaveBeenCalled();

      // Non-object payload to custom-typed column
      await expect(
        repo.update(1, {
          total: 'raw-string' as unknown as Money,
        }),
      ).rejects.toThrowError(/money payload must be an object/);

      expect(execute).not.toHaveBeenCalled();
    });

    it('rejects custom-typed write payloads when write encoding (toDb) throws an exception', async () => {
      const execute = vi.fn(async () => []);
      const repo = defineRepository(OrderSchema, { dialect: officialDialects.postgres, execute });

      await expect(
        repo.create({
          total: { amount: 100, currency: 'CAD' }, // Unsupported currency throws in toDb
          discount: null,
        }),
      ).rejects.toThrowError(/serialization failed for "total": unsupported currency: CAD/);

      expect(execute).not.toHaveBeenCalled();
    });

    it('enforces nullability rules on custom-typed columns', async () => {
      const execute = vi.fn(async () => []);
      const repo = defineRepository(OrderSchema, { dialect: officialDialects.postgres, execute });

      // Non-nullable total column provided null
      await expect(
        repo.create({
          total: null as unknown as Money,
          discount: null,
        }),
      ).rejects.toThrowError(/column "total" is not nullable/);

      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('json column runtime validation', () => {
    type CS = ConfigRow;

    class ConfigRepo extends BaseRepository<CS> {
      static override readonly schema = ConfigSchema;
    }

    it('accepts valid object and array payloads for json columns on create and update', async () => {
      const execute = vi.fn(async (): Promise<Record<string, unknown>[]> => [
        { id: 1, settings: { theme: 'dark' }, tags: ['a', 'b'], optionalNotes: null },
      ]);
      const repo = new ConfigRepo({ dialect: officialDialects.postgres, execute });

      const created = await repo.create({
        settings: { theme: 'dark' },
        tags: ['a', 'b'],
        optionalNotes: null,
      });

      expect(execute).toHaveBeenCalledTimes(1);
      expect(created.settings).toEqual({ theme: 'dark' });

      execute.mockResolvedValueOnce([
        { id: 1, settings: { theme: 'light' }, tags: ['a'], optionalNotes: { note: 'x' } },
      ]);
      const updated = await repo.update(1, {
        settings: { theme: 'light' },
        optionalNotes: { note: 'x' },
      });

      expect(updated?.settings).toEqual({ theme: 'light' });
    });

    it('rejects primitive scalar values for json columns on create and update', async () => {
      const execute = vi.fn(async (): Promise<Record<string, unknown>[]> => []);
      const repo = new ConfigRepo({ dialect: officialDialects.postgres, execute });

      // Number primitive supplied to settings
      await expect(
        repo.create({ settings: 123 as unknown as Config, tags: ['a'], optionalNotes: null }),
      ).rejects.toBeInstanceOf(ValidationError);

      // String primitive supplied to settings
      await expect(
        repo.create({ settings: 'not-an-object' as unknown as Config, tags: ['a'], optionalNotes: null }),
      ).rejects.toBeInstanceOf(ValidationError);

      // Boolean primitive supplied to tags
      await expect(
        repo.create({ settings: { theme: 'dark' }, tags: true as unknown as string[], optionalNotes: null }),
      ).rejects.toBeInstanceOf(ValidationError);

      // Primitive scalar on update
      await expect(repo.update(1, { settings: 'invalid-string' as unknown as Config })).rejects.toBeInstanceOf(
        ValidationError,
      );

      expect(execute).not.toHaveBeenCalled();
    });

    it('allows explicit null for nullable json columns while rejecting primitives', async () => {
      const execute = vi.fn(async (): Promise<Record<string, unknown>[]> => [
        { id: 1, settings: { theme: 'dark' }, tags: [], optionalNotes: null },
      ]);
      const repo = new ConfigRepo({ dialect: officialDialects.postgres, execute });

      await expect(repo.create({ settings: { theme: 'dark' }, tags: [], optionalNotes: null })).resolves.toBeDefined();

      // Null on non-nullable settings column throws ValidationError
      await expect(
        repo.create({ settings: null as unknown as Config, tags: [], optionalNotes: null }),
      ).rejects.toBeInstanceOf(ValidationError);

      // Primitive on nullable optionalNotes column throws ValidationError
      await expect(repo.update(1, { optionalNotes: 456 as unknown as { note: string } })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });
});

describe('typed single-record upsert', () => {
  it('upsert validates payload, triggers pre/post insert hooks, and calls driver with conflict SQL', async () => {
    const preHook = vi.fn();
    const postHook = vi.fn();

    class HookedUsers extends Users {
      protected override preInsert(row: Record<string, unknown>): void {
        preHook(row);
      }
      protected override postInsert(row: Record<string, unknown>): void {
        postHook(row);
      }
    }

    const execute = vi.fn(async (_q: CompiledQuery) => [{ id: 1, email: 'a@b.com', age: 30, role: 'user' }]);
    const repo = new HookedUsers({ dialect: officialDialects.postgres, execute });

    const out = await repo.upsert({ email: 'a@b.com', age: 30 } as CreateDTO<User>);

    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0]![0];
    expect(query.text).toContain('ON CONFLICT ("id") DO UPDATE SET');

    expect(preHook).toHaveBeenCalledWith({ email: 'a@b.com', age: 30 });
    expect(postHook).toHaveBeenCalledWith({ id: 1, email: 'a@b.com', age: 30, role: 'user' });
    expect(out?.id).toBe(1);
  });

  it('upsert throws ValidationError prior to query generation & driver execution on invalid input', async () => {
    const execute = vi.fn(async () => []);
    const repo = new Users({ dialect: officialDialects.postgres, execute });

    // Missing required field 'age'
    await expect(repo.upsert({ email: 'a@b.com' } as unknown as CreateDTO<User>)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('upsert formats target and updateFields SQL', async () => {
    const execute = vi.fn(async (_q: CompiledQuery) => [{ id: 1, email: 'a@b.com', age: 30, role: 'user' }]);
    const repo = new Users({ dialect: officialDialects.postgres, execute });

    await repo.upsert({ email: 'a@b.com', age: 30 } as CreateDTO<User>, { target: 'email', updateFields: ['age'] });

    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0]![0];
    expect(query.text).toContain('ON CONFLICT ("email") DO UPDATE SET "age" = EXCLUDED."age"');
  });
});

describe('MySQL-family row-returning repository writes (#606)', () => {
  const operations = [
    {
      name: 'create',
      statement: 'INSERT',
      run: (repo: Users) => repo.create({ email: 'a@b.com', age: 30 }),
    },
    {
      name: 'update',
      statement: 'UPDATE',
      run: (repo: Users) => repo.update(1, { age: 31 }),
    },
    {
      name: 'upsert',
      statement: 'UPSERT',
      run: (repo: Users) => repo.upsert({ email: 'a@b.com', age: 30 }, { target: 'email', updateFields: ['age'] }),
    },
  ] as const;

  for (const dialect of ['mysql', 'singlestore'] as const) {
    for (const operation of operations) {
      it(`${dialect} ${operation.name} refuses before driver execution when its return contract needs a row`, async () => {
        const calls: CompiledQuery[] = [];
        const repo = new Users(
          {
            dialect: officialDialects[dialect],
            execute(query) {
              calls.push(query);
              return Promise.resolve([]);
            },
          },
          officialDialects[dialect],
        );

        const failure = await operation.run(repo).then(
          () => undefined,
          (error: unknown) => error,
        );
        expect(failure).toBeInstanceOf(UnsupportedFeatureError);
        if (!(failure instanceof UnsupportedFeatureError)) throw new Error('expected UnsupportedFeatureError');
        expect(failure).toMatchObject({
          feature: 'returning',
          dialect,
          message:
            `returning is not supported for ${operation.statement} on dialect "${dialect}"; ` +
            'omit returning() and perform an explicit read',
        });
        expect(calls).toEqual([]);
      });
    }

    it(`${dialect} keeps the explicit one-statement undefined-returning repository branches`, async () => {
      const calls: CompiledQuery[] = [];
      const repo = new Users(
        {
          dialect: officialDialects[dialect],
          execute(query) {
            calls.push(query);
            return Promise.resolve([]);
          },
        },
        officialDialects[dialect],
      );

      await expect(repo.update(1, { age: inc(1) })).resolves.toBeUndefined();
      await expect(repo.updateMany({ role: 'user' }, { age: inc(2) })).resolves.toBeUndefined();
      await expect(
        repo.upsert(
          { email: 'a@b.com', age: 30 },
          {
            target: 'email',
            updateFields: { age: inc(3) },
          },
        ),
      ).resolves.toBeUndefined();

      expect(calls).toEqual([
        {
          text: 'UPDATE `users` SET `age` = `age` + ? WHERE `id` = ?',
          parameters: [1, 1],
        },
        {
          text: 'UPDATE `users` SET `age` = `age` + ? WHERE `role` = ?',
          parameters: [2, 'user'],
        },
        {
          text: 'INSERT INTO `users` (`email`, `age`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `age` = `age` + ?',
          parameters: ['a@b.com', 30, 3],
        },
      ]);
      for (const query of calls) expect(query.text.toUpperCase()).not.toContain('RETURNING');
    });
  }
});
