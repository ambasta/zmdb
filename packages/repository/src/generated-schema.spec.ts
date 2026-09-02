import type { Dialect } from '@zmdb/query-compiler';
import { diff, emitUp, snapshot, type SchemaSnapshot } from '@zmdb/query-compiler/migrations';
import {
  bigint,
  boolean,
  defineSchema,
  integer,
  json,
  jsonEnum,
  numeric,
  references,
  serial,
  sensitive,
  text,
  timestamp,
  varchar,
  type CoreSchema,
} from '@zmdb/schema-core';
import { irFromSchema, schemaFromIR } from '@zmdb/schema-core/ir';
import { describe, it, expect } from 'vitest';

import { defineRepository, type Driver } from './index.ts';

// REQ-TF-10. `schemaFromIR` is what a tagged declaration becomes at build time: the
// query compiler wants the table name and the column types as data, and a generated
// literal is data. The claim is that it is the *same* data — so this file takes every
// schema value the repo can build, generates its twin, and asserts that every piece of
// SQL either of them produces is byte-identical, in all three dialects.
//
// That reuses the entire existing SQL suite as the correctness proof rather than adding
// a second one: if the generated value compiles the same DDL and the same CRUD, then
// every dialect test, every DDL test and every repository test already covers it.
//
// The corpus is deliberately awkward. Between the three tables: every `SqlType`, a
// composite primary key, a non-serial primary key, foreign keys both derived and
// declared, nullable and defaulted columns, a sensitive column, an FTS table, and a
// column carrying a rule the IR keeps as a name rather than a constraint.

const Users = defineSchema('users', {
  id: serial().primaryKey(),
  email: varchar(255).unique().validate({ kind: 'pattern', value: '^\\S+@\\S+$' }),
  age: integer().validate({ kind: 'minimum', value: 18 }).validate({ kind: 'maximum', value: 120 }),
  score: numeric().nullable(),
  visits: bigint(),
  bio: text().nullable().validate({ kind: 'maxLength', value: 2000 }),
  active: boolean().defaultTo(true),
  createdAt: timestamp().defaultTo('now()'),
  role: jsonEnum(['admin', 'editor', 'viewer']).defaultTo('viewer'),
  settings: json<{ theme: string }>(),
  passwordHash: sensitive(text()),
});

const Memberships = defineSchema('memberships', {
  userId: references(integer().primaryKey(), 'users', 'id'),
  groupId: integer().primaryKey(),
  note: text().nullable().validate({ kind: 'luhn' }),
});

const Documents = defineSchema(
  'documents',
  {
    slug: text().primaryKey(),
    body: text(),
  },
  { ftsTable: true },
);

const DIALECTS: readonly Dialect[] = ['postgres', 'mysql', 'sqlite'];
const EMPTY: SchemaSnapshot = { version: 1, tables: [] };

/** Every operation this repository can run, as SQL, for one schema. */
async function everySql(schema: CoreSchema<string>, dialect: Dialect): Promise<readonly unknown[]> {
  const compiled: unknown[] = [];
  const driver: Driver = {
    execute: async query => {
      compiled.push(query);
      // One row back, so a method that reads its result keeps going instead of
      // short-circuiting on an empty set and compiling less SQL than its twin.
      return [{ id: 1, userId: 1, groupId: 2, slug: 'a', email: 'a@b.com' }];
    },
  };
  const repo = defineRepository(schema, driver, { dialect });
  const pk = schema.primaryKey.length > 1 ? { userId: 1, groupId: 2 } : 1;
  const first = Object.keys(schema.columns)[1] ?? 'id';

  await repo.findById(pk);
  await repo.findAll();
  await repo.find({ [first]: 'x' });
  await repo.findOne({ [first]: { ne: null } });
  await repo.list({
    where: { [first]: 'x' },
    orderBy: [{ column: first, dir: 'desc' }],
    page: { limit: 10, offset: 5 },
  });
  await repo.aggregate({ computed: { total: { fn: 'count' } } });
  await repo.delete(pk);
  return compiled;
}

/** The `CREATE TABLE` a migration would write for one schema, in one dialect. */
function ddl(schema: CoreSchema<string>, dialect: Dialect): readonly string[] {
  return diff(EMPTY, snapshot([schema])).map(op => emitUp(op, dialect));
}

describe('a generated schema value compiles the same SQL as the authored one', () => {
  for (const authored of [Users, Memberships, Documents]) {
    const generated = schemaFromIR(irFromSchema(authored));

    describe(authored.table, () => {
      for (const dialect of DIALECTS) {
        it(`emits identical DDL (${dialect})`, () => {
          expect(ddl(generated, dialect)).toEqual(ddl(authored, dialect));
          // Not vacuous: the corpus has to actually produce DDL.
          expect(ddl(authored, dialect)[0]).toContain('CREATE TABLE');
        });

        it(`compiles identical queries (${dialect})`, async () => {
          const [fromGenerated, fromAuthored] = await Promise.all([
            everySql(generated, dialect),
            everySql(authored, dialect),
          ]);
          expect(fromGenerated).toEqual(fromAuthored);
          expect(fromAuthored.length).toBeGreaterThan(6);
        });
      }

      it('accepts the same writes, and compiles them the same way', async () => {
        // `create` and `update` run the payload validator first, so this also asserts the
        // generated value validates identically — a dropped flag would show up as one
        // side throwing where the other emits an INSERT.
        const dto: Record<string, unknown> =
          {
            users: { email: 'a@b.com', age: 30, visits: 1n, bio: null, score: null, settings: {}, passwordHash: 'x' },
            memberships: { userId: 1, groupId: 2, note: null },
            documents: { slug: 'a', body: 'b' },
          }[authored.table] ?? {};

        const writes = async (schema: CoreSchema<string>): Promise<readonly unknown[]> => {
          const compiled: unknown[] = [];
          const driver: Driver = {
            execute: async query => {
              compiled.push(query);
              return [{ ...dto, id: 1 }];
            },
          };
          const repo = defineRepository(schema, driver);
          await repo.create(dto);
          await repo.upsert(dto);
          await repo.update(schema.primaryKey.length > 1 ? { userId: 1, groupId: 2 } : 1, {});
          return compiled;
        };

        expect(await writes(generated)).toEqual(await writes(authored));
      });
    });
  }
});
