import { createQueryCompiler, type CompiledQuery, type Dialect } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

// Tests freeze for query-compiler/SPEC.md §5b.
//
// The constructors do not exist at 9e6b9757. Importing missing named exports would
// stop this file at module linking, before an `it.fails` could record the compiler's
// real answer. This boundary asks the public module for a constructor and otherwise
// supplies the exact symbol-branded frozen shape. Current `set()` receives that value
// and parameterises it as ordinary data; once #444 exports a constructor, the same
// tests automatically exercise the shipped brand instead.
const FROZEN_EXPR = Symbol('zmdb.tests.expression');
const publicApi: object = await import('@zmdb/query-compiler');

function expression(name: string, args: readonly unknown[], shape: Record<string, unknown>): unknown {
  const exported: unknown = Reflect.get(publicApi, name);
  if (typeof exported === 'function') return Reflect.apply(exported, undefined, args);
  const publicBrand: unknown = Reflect.get(publicApi, 'EXPR');
  return Object.defineProperty(shape, typeof publicBrand === 'symbol' ? publicBrand : FROZEN_EXPR, { value: true });
}

function inc(by: unknown = 1): unknown {
  return expression('inc', [by], { op: 'add', by });
}

function dec(by: unknown = 1): unknown {
  return expression('dec', [by], { op: 'sub', by });
}

function mul(by: unknown): unknown {
  return expression('mul', [by], { op: 'mul', by });
}

function not(): unknown {
  return expression('not', [], { op: 'not' });
}

function concat(withText: string): unknown {
  return expression('concat', [withText], { op: 'concat', with: withText });
}

function coalesce(fallback: unknown): unknown {
  return expression('coalesce', [fallback], { op: 'coalesce', fallback });
}

function proposed(): unknown {
  return expression('proposed', [], { op: 'proposed' });
}

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql', 'sqlite'];

type Golden = Readonly<Record<Dialect, CompiledQuery>>;

function expectAcrossDialects(build: (dialect: Dialect) => CompiledQuery, golden: Golden): void {
  for (const dialect of DIALECTS) expect(build(dialect), dialect).toEqual(golden[dialect]);
}

describe('expression-valued SET (frozen: query-compiler/SPEC.md 5b)', () => {
  // actual at 9e6b9757:
  //   postgres  UPDATE "posts" SET "views" = $1 WHERE "id" = $2
  //   mysql     UPDATE `posts` SET `views` = ? WHERE `id` = ?
  //   sqlite    UPDATE "posts" SET "views" = ? WHERE "id" = ?
  //   parameters: [{ op: 'add', by: 1 }, 7]
  it.fails('increments a column without reading it first', () => {
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

  // actual today binds `{ op: 'sub', by: 1 }` as the SET value in every dialect.
  it.fails('decrements with a default step of one', () => {
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

  // `mul` is the sixth non-upsert variant in the accepted SPEC, although the live
  // tests-freeze issue's title list predates it.
  it.fails('multiplies a column by a parameter', () => {
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

  // actual today binds `{ op: 'not' }`; it contributes one SET parameter instead
  // of emitting an operand-free expression.
  it.fails('toggles a boolean with the dialect negation operator', () => {
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

  // actual today binds `{ op: 'concat', with: ' (draft)' }` as one value.
  it.fails('concatenates onto a column using the dialect concat form', () => {
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

  // actual today binds `{ op: 'coalesce', fallback: 'anonymous' }` as one value.
  it.fails('coalesces a nullable column to a fallback', () => {
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

  // actual today has the same placeholder positions but parameter 1 is the branded
  // object, not the operand `2`.
  it.fails('mixes an expression column and a value column in one SET', () => {
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

  // actual today appends `{ op: 'proposed' }` as a third parameter and emits a
  // placeholder in the update clause.
  it.fails('references the proposed row in an upsert update clause', () => {
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
  it.fails('increments the stored row in an upsert update clause', () => {
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

  // actual today: compilation succeeds and binds the object. The frozen failure is
  // the method-level refusal required by §5b.4.
  it.fails('rejects proposed() outside an upsert with a message naming the method', () => {
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

  // Green control over shipping behavior: expression detection must not be duck-typed.
  // This object has the vocabulary's fields but no symbol brand, and current HEAD
  // correctly binds it as data in all three dialects.
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
