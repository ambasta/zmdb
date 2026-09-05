import { schemasFrom } from '@zmdb/aot-validator/testing';
import { inc, UnsupportedFeatureError, type CompiledQuery } from '@zmdb/query-compiler';
import type { CreateDTO, UpdateDTO } from '@zmdb/schema-core';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, ValidationError, type Driver } from '../index.js';
import { Users, type User } from './fixtures.js';

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
    const repo = new Users({ execute } as Driver);
    const dto: CreateDTO<User> = { email: 'a@b.com', age: 30 };
    const out = await repo.create(dto);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out.id).toBe(1);
  });

  it('create throws ValidationError and does NOT call the driver on invalid input', async () => {
    const execute = vi.fn(async () => []);
    const repo = new Users({ execute } as Driver);
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
    const repo = new Users({ execute } as Driver);
    const patch: UpdateDTO<User> = { role: 'admin' };
    const out = await repo.update(1, patch);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out?.role).toBe('admin');
  });
  it('update strips explicit undefined properties before payload validation', async () => {
    const execute = vi.fn(async (_q: unknown) => [{ id: 1, email: 'a@b.com', age: 32, role: 'user' }]);
    const repo = new Users({ execute } as Driver);
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

  describe('json column runtime validation', () => {
    type CS = ConfigRow;

    class ConfigRepo extends BaseRepository<CS> {
      static override readonly schema = ConfigSchema;
    }

    it('accepts valid object and array payloads for json columns on create and update', async () => {
      const execute = vi.fn(async (): Promise<Record<string, unknown>[]> => [
        { id: 1, settings: { theme: 'dark' }, tags: ['a', 'b'], optionalNotes: null },
      ]);
      const repo = new ConfigRepo({ execute } as Driver);

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
      const repo = new ConfigRepo({ execute } as Driver);

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
      const repo = new ConfigRepo({ execute } as Driver);

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

  describe('strict payload deserialization failure cases', () => {
    it('rejects unknown keys with specific error path and message', async () => {
      const execute = vi.fn(async () => []);
      const repo = new Users({ execute } as Driver);

      try {
        await repo.create({ email: 'a@b.com', age: 30, unknownKey: 'foo' } as unknown as CreateDTO<User>);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.issues).toEqual([
          {
            path: 'input.unknownKey',
            message: '"unknownKey" is not a column of "users"',
            expected: 'no excess properties',
            value: 'foo',
          },
        ]);
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('rejects wrong primitive types with specific error path and message', async () => {
      const execute = vi.fn(async () => []);
      const repo = new Users({ execute } as Driver);

      try {
        await repo.create({ email: 'a@b.com', age: 'thirty' as unknown as number } as CreateDTO<User>);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.issues).toEqual([
          { path: 'input.age', message: 'expected integer', expected: 'integer', value: 'thirty' },
        ]);
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('rejects null into non-nullable column with specific error path and message', async () => {
      const execute = vi.fn(async () => []);
      const repo = new Users({ execute } as Driver);

      try {
        await repo.create({ email: null as unknown as string, age: 30 } as CreateDTO<User>);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.issues).toEqual([
          {
            path: 'input.email',
            message: 'expected string',
            expected: 'string',
            value: null,
          },
        ]);
      }
      expect(execute).not.toHaveBeenCalled();
    });

    it('rejects prototype-polluting keys like __proto__ and constructor with specific error path and message', async () => {
      const execute = vi.fn(async () => []);
      const repo = new Users({ execute } as Driver);

      const protoPayload = JSON.parse('{"email":"a@b.com","age":30,"__proto__":{"admin":true}}');
      try {
        await repo.create(protoPayload as CreateDTO<User>);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.issues).toEqual([
          {
            path: 'input.__proto__',
            message: 'disallowed property "__proto__"',
            expected: 'no excess properties',
            value: { admin: true },
          },
        ]);
      }

      const ctorPayload = JSON.parse('{"email":"a@b.com","age":30,"constructor":{"admin":true}}');
      try {
        await repo.create(ctorPayload as CreateDTO<User>);
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ValidationError);
        const valErr = err as ValidationError;
        expect(valErr.issues).toEqual([
          {
            path: 'input.constructor',
            message: 'disallowed property "constructor"',
            expected: 'no excess properties',
            value: { admin: true },
          },
        ]);
      }
      expect(execute).not.toHaveBeenCalled();
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
    const repo = new HookedUsers({ execute } as Driver);

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
    const repo = new Users({ execute } as Driver);

    // Missing required field 'age'
    await expect(repo.upsert({ email: 'a@b.com' } as unknown as CreateDTO<User>)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('upsert formats target and updateFields SQL', async () => {
    const execute = vi.fn(async (_q: CompiledQuery) => [{ id: 1, email: 'a@b.com', age: 30, role: 'user' }]);
    const repo = new Users({ execute } as Driver);

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
            dialect,
            execute(query) {
              calls.push(query);
              return Promise.resolve([]);
            },
          },
          dialect,
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
          dialect,
          execute(query) {
            calls.push(query);
            return Promise.resolve([]);
          },
        },
        dialect,
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
