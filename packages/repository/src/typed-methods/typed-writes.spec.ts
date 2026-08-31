import { defineSchema, serial, text, integer, json, jsonEnum, nullable } from '@zmdb/schema-core';
import type { CreateDTO, UpdateDTO } from '@zmdb/schema-core';
import { describe, it, expect, vi } from 'vitest';

import { BaseRepository, ValidationError, type Driver } from '../index.ts';

const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  age: integer().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
});
type S = typeof UserSchema;

class Users extends BaseRepository<S> {
  static override readonly schema = UserSchema;
}

// The DTO signatures these tests exercise are asserted in
// `typed-methods.type-test.ts` — this file covers validation and the driver calls.
describe('typed create/update (#206)', () => {
  it('create validates then inserts, returning the row', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 30, role: 'user' }]);
    const repo = new Users({ execute } as Driver);
    const dto: CreateDTO<S> = { email: 'a@b.com', age: 30 };
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
    await expect(repo.create({ email: 'a@b.com' } as unknown as CreateDTO<S>)).rejects.toBeInstanceOf(ValidationError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('update validates a partial patch then updates', async () => {
    const execute = vi.fn(async () => [{ id: 1, email: 'a@b.com', age: 31, role: 'admin' }]);
    const repo = new Users({ execute } as Driver);
    const patch: UpdateDTO<S> = { role: 'admin' };
    const out = await repo.update(1, patch);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out?.role).toBe('admin');
  });
  it('update strips explicit undefined properties before payload validation', async () => {
    const execute = vi.fn(async (_q: unknown) => [{ id: 1, email: 'a@b.com', age: 32, role: 'user' }]);
    const repo = new Users({ execute } as Driver);
    const out = await repo.update(1, { age: 32, email: undefined } as UpdateDTO<S>);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(out?.age).toBe(32);
    // Check compiled SQL parameter only contains age, not email
    const query = execute.mock.calls[0]?.[0] as { text: string; parameters: unknown[] } | undefined;
    expect(query?.text).toContain('UPDATE "users" SET "age" = $1 WHERE "id" = $2');
    expect(query?.parameters).toEqual([32, 1]);

  describe('json column runtime validation', () => {
    interface Config {
      theme: string;
    }
    const ConfigSchema = defineSchema('configs', {
      id: serial().primaryKey(),
      settings: json<Config>(),
      tags: json<string[]>(),
      optionalNotes: nullable(json<{ note: string }>()),
    });
    type CS = typeof ConfigSchema;

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
});
