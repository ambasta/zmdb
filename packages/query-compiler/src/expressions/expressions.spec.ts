import {
  EXPR,
  coalesce,
  concat,
  createQueryCompiler,
  dec,
  inc,
  mul,
  not,
  proposed,
  type CompiledQuery,
  type Dialect,
} from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql', 'sqlite'];

type Golden = Readonly<Record<Dialect, CompiledQuery>>;

function expectAcrossDialects(build: (dialect: Dialect) => CompiledQuery, golden: Golden): void {
  for (const dialect of DIALECTS) expect(build(dialect), dialect).toEqual(golden[dialect]);
}

describe('expression-valued SET (frozen: query-compiler/SPEC.md 5b)', () => {
  it('brands expressions with a non-enumerable symbol', () => {
    const expression = inc(1);
    expect(Object.getOwnPropertyDescriptor(expression, EXPR)).toMatchObject({
      value: true,
      enumerable: false,
    });
  });

  it('increments a column without reading it first', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect)
          .updateTable('posts')
          .set({ views: inc(1) })
          .where('id', '=', 7)
          .compile(),
      {
        postgres: {
          text: 'UPDATE "posts" SET "views" = "views" + $1 WHERE "id" = $2',
          parameters: [1, 7],
        },
        mysql: {
          text: 'UPDATE `posts` SET `views` = `views` + ? WHERE `id` = ?',
          parameters: [1, 7],
        },
        sqlite: {
          text: 'UPDATE "posts" SET "views" = "views" + ? WHERE "id" = ?',
          parameters: [1, 7],
        },
      },
    );
  });

  it('decrements with a default step of one', () => {
    expectAcrossDialects(
      dialect => createQueryCompiler(dialect).updateTable('posts').set({ stock: dec() }).where('id', '=', 7).compile(),
      {
        postgres: {
          text: 'UPDATE "posts" SET "stock" = "stock" - $1 WHERE "id" = $2',
          parameters: [1, 7],
        },
        mysql: {
          text: 'UPDATE `posts` SET `stock` = `stock` - ? WHERE `id` = ?',
          parameters: [1, 7],
        },
        sqlite: {
          text: 'UPDATE "posts" SET "stock" = "stock" - ? WHERE "id" = ?',
          parameters: [1, 7],
        },
      },
    );
  });

  it('multiplies a column by a parameter', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect)
          .updateTable('posts')
          .set({ score: mul(3) })
          .where('id', '=', 7)
          .compile(),
      {
        postgres: {
          text: 'UPDATE "posts" SET "score" = "score" * $1 WHERE "id" = $2',
          parameters: [3, 7],
        },
        mysql: {
          text: 'UPDATE `posts` SET `score` = `score` * ? WHERE `id` = ?',
          parameters: [3, 7],
        },
        sqlite: {
          text: 'UPDATE "posts" SET "score" = "score" * ? WHERE "id" = ?',
          parameters: [3, 7],
        },
      },
    );
  });

  it('toggles a boolean with the dialect negation operator', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect).updateTable('posts').set({ published: not() }).where('id', '=', 7).compile(),
      {
        postgres: {
          text: 'UPDATE "posts" SET "published" = NOT "published" WHERE "id" = $1',
          parameters: [7],
        },
        mysql: {
          text: 'UPDATE `posts` SET `published` = NOT `published` WHERE `id` = ?',
          parameters: [7],
        },
        sqlite: {
          text: 'UPDATE "posts" SET "published" = NOT "published" WHERE "id" = ?',
          parameters: [7],
        },
      },
    );
  });

  it('concatenates onto a column using the dialect concat form', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect)
          .updateTable('posts')
          .set({ title: concat(' (draft)') })
          .where('id', '=', 7)
          .compile(),
      {
        postgres: {
          text: 'UPDATE "posts" SET "title" = "title" || $1 WHERE "id" = $2',
          parameters: [' (draft)', 7],
        },
        mysql: {
          text: 'UPDATE `posts` SET `title` = CONCAT(`title`, ?) WHERE `id` = ?',
          parameters: [' (draft)', 7],
        },
        sqlite: {
          text: 'UPDATE "posts" SET "title" = "title" || ? WHERE "id" = ?',
          parameters: [' (draft)', 7],
        },
      },
    );
  });

  it('coalesces a nullable column to a fallback', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect)
          .updateTable('users')
          .set({ nickname: coalesce('anonymous') })
          .where('id', '=', 7)
          .compile(),
      {
        postgres: {
          text: 'UPDATE "users" SET "nickname" = COALESCE("nickname", $1) WHERE "id" = $2',
          parameters: ['anonymous', 7],
        },
        mysql: {
          text: 'UPDATE `users` SET `nickname` = COALESCE(`nickname`, ?) WHERE `id` = ?',
          parameters: ['anonymous', 7],
        },
        sqlite: {
          text: 'UPDATE "users" SET "nickname" = COALESCE("nickname", ?) WHERE "id" = ?',
          parameters: ['anonymous', 7],
        },
      },
    );
  });

  it('mixes an expression column and a value column in one SET', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect)
          .updateTable('posts')
          .set({ views: inc(2), title: 'published' })
          .where('id', '=', 7)
          .compile(),
      {
        postgres: {
          text: 'UPDATE "posts" SET "views" = "views" + $1, "title" = $2 WHERE "id" = $3',
          parameters: [2, 'published', 7],
        },
        mysql: {
          text: 'UPDATE `posts` SET `views` = `views` + ?, `title` = ? WHERE `id` = ?',
          parameters: [2, 'published', 7],
        },
        sqlite: {
          text: 'UPDATE "posts" SET "views" = "views" + ?, "title" = ? WHERE "id" = ?',
          parameters: [2, 'published', 7],
        },
      },
    );
  });

  it('references the proposed row in an upsert update clause', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect)
          .insertInto('counters')
          .values({ key: 'k', stock: 5 })
          .onConflict('key')
          .doUpdate({ stock: proposed() })
          .compile(),
      {
        postgres: {
          text:
            'INSERT INTO "counters" ("key", "stock") VALUES ($1, $2) ' +
            'ON CONFLICT ("key") DO UPDATE SET "stock" = EXCLUDED."stock"',
          parameters: ['k', 5],
        },
        mysql: {
          text:
            'INSERT INTO `counters` (`key`, `stock`) VALUES (?, ?) ' +
            'ON DUPLICATE KEY UPDATE `stock` = VALUES(`stock`)',
          parameters: ['k', 5],
        },
        sqlite: {
          text:
            'INSERT INTO "counters" ("key", "stock") VALUES (?, ?) ' +
            'ON CONFLICT ("key") DO UPDATE SET "stock" = EXCLUDED."stock"',
          parameters: ['k', 5],
        },
      },
    );
  });

  // The stored-row rule is separate from `proposed`: an increment inside an upsert
  // remains an unqualified reference to the row that already exists.
  it('increments the stored row in an upsert update clause', () => {
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect)
          .insertInto('counters')
          .values({ key: 'k', hits: 1 })
          .onConflict('key')
          .doUpdate({ hits: inc(1) })
          .compile(),
      {
        postgres: {
          text:
            'INSERT INTO "counters" ("key", "hits") VALUES ($1, $2) ' +
            'ON CONFLICT ("key") DO UPDATE SET "hits" = "hits" + $3',
          parameters: ['k', 1, 1],
        },
        mysql: {
          text: 'INSERT INTO `counters` (`key`, `hits`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `hits` = `hits` + ?',
          parameters: ['k', 1, 1],
        },
        sqlite: {
          text:
            'INSERT INTO "counters" ("key", "hits") VALUES (?, ?) ' +
            'ON CONFLICT ("key") DO UPDATE SET "hits" = "hits" + ?',
          parameters: ['k', 1, 1],
        },
      },
    );
  });

  it('rejects proposed() outside an upsert with a message naming the method', () => {
    for (const dialect of DIALECTS) {
      expect(
        () => createQueryCompiler(dialect).updateTable('counters').set({ hits: proposed() }).compile(),
        dialect,
      ).toThrow(
        'proposed() references the row being inserted and is only valid inside onConflict().doUpdate() ' +
          '("hits" on "counters")',
      );
    }
  });

  it('does not treat a plain object column value as an expression', () => {
    const document = { op: 'add', by: 1 };
    expectAcrossDialects(
      dialect =>
        createQueryCompiler(dialect).updateTable('documents').set({ payload: document }).where('id', '=', 7).compile(),
      {
        postgres: {
          text: 'UPDATE "documents" SET "payload" = $1 WHERE "id" = $2',
          parameters: [document, 7],
        },
        mysql: {
          text: 'UPDATE `documents` SET `payload` = ? WHERE `id` = ?',
          parameters: [document, 7],
        },
        sqlite: {
          text: 'UPDATE "documents" SET "payload" = ? WHERE "id" = ?',
          parameters: [document, 7],
        },
      },
    );
  });
});
