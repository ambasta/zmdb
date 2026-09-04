import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import type { CompiledQuery } from '@zmdb/query-compiler';
import { BaseRepository, type Driver } from '@zmdb/repository';
import { sqliteDriver } from '@zmdb/repository/drivers/sqlite';
import type { UpdateDTO } from '@zmdb/schema-core';
import type { Pattern, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { describe, expect, it } from 'vitest';

// Repository-side tests freeze for repository/SPEC.md §3b. The constructor
// boundary mirrors the compiler test: use the public constructor when #444 ships,
// otherwise pass the exact branded shape to today's real validation/compiler path.
const FROZEN_EXPR = Symbol('zmdb.tests.expression');
const publicApi: object = await import('@zmdb/query-compiler');

function inc(by: unknown = 1): unknown {
  const exported: unknown = Reflect.get(publicApi, 'inc');
  if (typeof exported === 'function') return Reflect.apply(exported, undefined, [by]);
  const publicBrand: unknown = Reflect.get(publicApi, 'EXPR');
  return Object.defineProperty({ op: 'add', by }, typeof publicBrand === 'symbol' ? publicBrand : FROZEN_EXPR, {
    value: true,
  });
}

export interface ExpressionPost extends Table<'expression_posts'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  views: number & Sql<'integer'>;
  email: string & Sql<'text'> & Pattern<'^\\S+@\\S+$'>;
  published: boolean & Sql<'boolean'>;
}

const { ExpressionPost: ExpressionPostSchema } = schemasFrom<{ ExpressionPost: ExpressionPost }>(import.meta.url, [
  'ExpressionPost',
]);

class ExpressionPosts extends BaseRepository<ExpressionPost> {
  static override readonly schema = ExpressionPostSchema;
}

type CurrentUpdatePatch = UpdateDTO<ExpressionPost>;

function frozenPatch(patch: Record<string, unknown>): CurrentUpdatePatch {
  // boundary: #443 exercises the accepted future UpdatePatch through today's real
  // `update(UpdateDTO)` method. The expression key is the only widened value, and
  // current validation is precisely the boundary under test.
  return patch as CurrentUpdatePatch;
}

function recordingDriver(rows: readonly Record<string, unknown>[]): Driver & { readonly calls: CompiledQuery[] } {
  const calls: CompiledQuery[] = [];
  return {
    calls,
    execute(query) {
      calls.push(query);
      return Promise.resolve(rows);
    },
  };
}

describe('repository expression-valued writes (frozen: repository/SPEC.md 3b)', () => {
  // actual at 9e6b9757: the first update rejects before SQL with
  // `input.views: expected integer`, where the value is `{ op: 'add', by: 2 }`.
  // The driver receives zero calls.
  it.fails('validates the operand of an expression and skips the row check for that column', async () => {
    const driver = recordingDriver([{ id: 1, views: 12, email: 'ok@example.com', published: false }]);
    const posts = new ExpressionPosts(driver);

    await posts.update(
      1,
      frozenPatch({
        views: inc(2),
        email: 'ok@example.com',
      }),
    );
    expect(driver.calls).toEqual([
      {
        text: 'UPDATE "expression_posts" SET "views" = "views" + $1, "email" = $2 WHERE "id" = $3 RETURNING *',
        parameters: [2, 'ok@example.com', 1],
      },
    ]);

    driver.calls.length = 0;
    await expect(posts.update(1, frozenPatch({ views: inc('two') }))).rejects.toMatchObject({
      issues: [{ path: 'input.views', message: 'expected integer', expected: 'integer', value: 'two' }],
    });
    expect(driver.calls).toEqual([]);

    await expect(
      posts.update(
        1,
        frozenPatch({
          views: inc(1),
          email: 'not-an-email',
        }),
      ),
    ).rejects.toMatchObject({
      issues: [
        {
          path: 'input.email',
          message: 'expected pattern ^\\S+@\\S+$',
          expected: 'pattern ^\\S+@\\S+$',
          value: 'not-an-email',
        },
      ],
    });
    expect(driver.calls).toEqual([]);
  });

  // actual today: the first call is rejected by repository validation and SQLite
  // remains at 10. The exact compiled-query assertions ensure a future
  // read-then-write implementation cannot satisfy this test.
  it.fails('increments atomically against a real database', async () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(
        'CREATE TABLE expression_posts (' +
          'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
          'views INTEGER NOT NULL, ' +
          'email TEXT NOT NULL, ' +
          'published INTEGER NOT NULL' +
          ')',
      );
      db.prepare('INSERT INTO expression_posts (views, email, published) VALUES (?, ?, ?)').run(
        10,
        'counter@example.com',
        0,
      );

      const sqlite = sqliteDriver(db);
      const calls: CompiledQuery[] = [];
      const driver: Driver = {
        dialect: 'sqlite',
        execute(query) {
          calls.push(query);
          return sqlite.execute(query);
        },
      };
      const posts = new ExpressionPosts(driver, 'sqlite');

      await posts.update(1, frozenPatch({ views: inc() }));
      await posts.update(1, frozenPatch({ views: inc() }));

      expect(calls).toEqual([
        {
          text: 'UPDATE "expression_posts" SET "views" = "views" + ? WHERE "id" = ? RETURNING *',
          parameters: [1, 1],
        },
        {
          text: 'UPDATE "expression_posts" SET "views" = "views" + ? WHERE "id" = ? RETURNING *',
          parameters: [1, 1],
        },
      ]);
      expect(db.prepare('SELECT views FROM expression_posts WHERE id = ?').get(1)).toEqual({ views: 12 });
    } finally {
      db.close();
    }
  });
});
