import { DatabaseSync } from 'node:sqlite';

import { schemasFrom } from '@zmdb/aot-validator/testing';
import { coalesce, concat, dec, inc, mul, type CompiledQuery } from '@zmdb/query-compiler';
import { BaseRepository, type Driver, type UpdatePatch } from '@zmdb/repository';
import type { Pattern, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { sqliteDriver } from '@zmdb/sqlite';
import { describe, expect, it } from 'vitest';

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

function expressionWithUncheckedOperand(constructor: object, operand: unknown): unknown {
  if (typeof constructor !== 'function') throw new Error('expected an expression constructor');
  return Reflect.apply(constructor, undefined, [operand]);
}

function uncheckedPatch(patch: Record<string, unknown>): UpdatePatch<ExpressionPost> {
  // Boundary: these calls deliberately model untyped input reaching the runtime
  // validator with an operand the constructor's public signature rejects.
  return patch as UpdatePatch<ExpressionPost>;
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
  it('validates the operand of an expression and skips the row check for that column', async () => {
    const driver = recordingDriver([{ id: 1, views: 12, email: 'ok@example.com', published: false }]);
    const posts = new ExpressionPosts(driver);

    await posts.update(1, {
      views: inc(2),
      email: 'ok@example.com',
    });
    expect(driver.calls).toEqual([
      {
        text: 'UPDATE "expression_posts" SET "views" = "views" + $1, "email" = $2 WHERE "id" = $3 RETURNING *',
        parameters: [2, 'ok@example.com', 1],
      },
    ]);

    driver.calls.length = 0;
    await expect(
      posts.update(
        1,
        uncheckedPatch({
          views: expressionWithUncheckedOperand(inc, 'two'),
        }),
      ),
    ).rejects.toMatchObject({
      issues: [{ path: 'input.views', message: 'expected integer', expected: 'integer', value: 'two' }],
    });
    expect(driver.calls).toEqual([]);

    await expect(
      posts.update(1, {
        views: inc(1),
        email: 'not-an-email',
      }),
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

  it('increments atomically against a real database', async () => {
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

      await posts.update(1, { views: inc() });
      await posts.update(1, { views: inc() });

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

  it('validates every expression operand against its column IR', async () => {
    const driver = recordingDriver([]);
    const posts = new ExpressionPosts(driver);
    const cases = [
      ['views', expressionWithUncheckedOperand(inc, 'two'), 'integer', 'two'],
      ['views', expressionWithUncheckedOperand(dec, 'two'), 'integer', 'two'],
      ['views', expressionWithUncheckedOperand(mul, 'two'), 'integer', 'two'],
      ['email', expressionWithUncheckedOperand(concat, 2), 'string', 2],
      ['email', expressionWithUncheckedOperand(coalesce, 2), 'string', 2],
    ] as const;

    for (const [column, expression, expected, value] of cases) {
      await expect(posts.update(1, uncheckedPatch({ [column]: expression }))).rejects.toMatchObject({
        issues: [{ path: `input.${column}`, expected, value }],
      });
    }
    expect(driver.calls).toEqual([]);
  });

  it('passes expressions to beforeUpdate in the documented form', async () => {
    const expression = inc(3);
    let seen: Record<string, unknown> | undefined;

    class HookedExpressionPosts extends ExpressionPosts {
      protected override preUpdate(patch: Record<string, unknown>): void {
        seen = patch;
      }
    }

    const posts = new HookedExpressionPosts(
      recordingDriver([{ id: 1, views: 13, email: 'ok@example.com', published: false }]),
    );
    await posts.update(
      1,
      uncheckedPatch({
        published: false,
        email: undefined,
        views: expression,
      }),
    );

    expect(seen).toEqual({ views: expression, published: false });
    expect(Object.keys(seen ?? {})).toEqual(['views', 'published']);
    expect(seen?.views).toBe(expression);
  });

  it('increments through the repository and returns the computed row', async () => {
    const driver = recordingDriver([{ id: 1, views: 12, email: 'ok@example.com', published: false }]);
    const posts = new ExpressionPosts(driver);

    await expect(posts.increment(1, 'views', 2)).resolves.toEqual({
      id: 1,
      views: 12,
      email: 'ok@example.com',
      published: false,
    });
    expect(driver.calls).toEqual([
      {
        text: 'UPDATE "expression_posts" SET "views" = "views" + $1 WHERE "id" = $2 RETURNING *',
        parameters: [2, 1],
      },
    ]);
  });

  it('omits unsupported MySQL RETURNING for expression repository writes', async () => {
    const driver = recordingDriver([]);
    const posts = new ExpressionPosts(driver, 'mysql');

    await expect(posts.increment(1, 'views')).resolves.toBeUndefined();
    await expect(posts.updateMany({ published: false }, { views: inc(2) })).resolves.toBeUndefined();
    await expect(
      posts.upsert(
        { views: 1, email: 'counter@example.com', published: false },
        { target: 'id', updateFields: { views: inc(3) } },
      ),
    ).resolves.toBeUndefined();

    expect(driver.calls).toEqual([
      {
        text: 'UPDATE `expression_posts` SET `views` = `views` + ? WHERE `id` = ?',
        parameters: [1, 1],
      },
      {
        text: 'UPDATE `expression_posts` SET `views` = `views` + ? WHERE `published` = ?',
        parameters: [2, false],
      },
      {
        text:
          'INSERT INTO `expression_posts` (`views`, `email`, `published`) VALUES (?, ?, ?) ' +
          'ON DUPLICATE KEY UPDATE `views` = `views` + ?',
        parameters: [1, 'counter@example.com', false, 3],
      },
    ]);
  });

  it('validates and emits expressions through updateMany and upsert', async () => {
    const rows = [
      { id: 1, views: 11, email: 'one@example.com', published: false },
      { id: 2, views: 21, email: 'two@example.com', published: false },
    ];
    const driver = recordingDriver(rows);
    const posts = new ExpressionPosts(driver);

    await expect(posts.updateMany({ published: false }, { views: inc(1) })).resolves.toBe(2);
    expect(driver.calls).toEqual([
      {
        text: 'UPDATE "expression_posts" SET "views" = "views" + $1 WHERE "published" = $2 RETURNING "id"',
        parameters: [1, false],
      },
    ]);

    driver.calls.length = 0;
    await posts.upsert(
      { views: 1, email: 'counter@example.com', published: false },
      { target: 'id', updateFields: { views: inc(1) } },
    );
    expect(driver.calls).toEqual([
      {
        text:
          'INSERT INTO "expression_posts" ("views", "email", "published") VALUES ($1, $2, $3) ' +
          'ON CONFLICT ("id") DO UPDATE SET "views" = "views" + $4 RETURNING *',
        parameters: [1, 'counter@example.com', false, 1],
      },
    ]);

    driver.calls.length = 0;
    await expect(
      posts.upsert(
        { views: 1, email: 'counter@example.com', published: false },
        {
          target: 'id',
          updateFields: uncheckedPatch({
            views: expressionWithUncheckedOperand(inc, 'two'),
          }),
        },
      ),
    ).rejects.toMatchObject({
      issues: [{ path: 'input.views', expected: 'integer', value: 'two' }],
    });
    expect(driver.calls).toEqual([]);
  });
});
