// Type surface for referential-action migrations (#455), frozen by `./SPEC.md`
// §1.6. Runtime behavior is in `migrations.spec.ts`; this file is compiled by
// `node scripts/typecheck.mjs`.

import type { DialectTarget } from '@zmdb/query-compiler';
import type { Equal, Expect } from '@zmdb/schema-core';

import type { ChangeOp, diff, ForeignKeySnapshot, TableSnapshot } from './index.js';

type FrozenReferentialAction = 'cascade' | 'restrict' | 'set null' | 'set default' | 'no action';

interface FrozenForeignKeySnapshot {
  readonly name: string;
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete: FrozenReferentialAction;
  readonly onUpdate: FrozenReferentialAction;
}

interface FrozenAddForeignKey {
  readonly kind: 'add_foreign_key';
  readonly table: string;
  readonly fk: FrozenForeignKeySnapshot;
}

interface FrozenDropForeignKey {
  readonly kind: 'drop_foreign_key';
  readonly table: string;
  readonly name: string;
}

export type _ForeignKeySnapshotShape = Expect<Equal<ForeignKeySnapshot, FrozenForeignKeySnapshot>>;

// Required, with [] as the only spelling of "no foreign keys".
type TableForeignKeys = TableSnapshot['foreignKeys'];
export type _ForeignKeysOnTable = Expect<Equal<TableForeignKeys, readonly FrozenForeignKeySnapshot[]>>;

export type _AddForeignKeyOp = Expect<Equal<Extract<ChangeOp, { kind: 'add_foreign_key' }>, FrozenAddForeignKey>>;

export type _DropForeignKeyOp = Expect<Equal<Extract<ChangeOp, { kind: 'drop_foreign_key' }>, FrozenDropForeignKey>>;

type CreateTable = Extract<ChangeOp, { kind: 'create_table' }>;

// SQLite's inline golden is impossible unless create_table carries the table's
// constraints. This is the smallest correction to the frozen ChangeOp surface.
type CreateTableForeignKeys = CreateTable['foreignKeys'];
export type _CreateTableCarriesForeignKeys = Expect<Equal<CreateTableForeignKeys, readonly FrozenForeignKeySnapshot[]>>;

// SQLite action changes and mutual-reference cycles need before/after plan
// context. The two frozen drop/add ops do not carry that context, so the
// dialect is an optional diff input rather than an invented third op.
type DiffOptions = Parameters<typeof diff>[2];
type DiffDialect = NonNullable<DiffOptions>['dialect'];
type FrozenDiffDialect = DialectTarget | undefined;
export type _DiffDialect = Expect<Equal<DiffDialect, FrozenDiffDialect>>;
