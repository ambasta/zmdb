// Type surface for referential-action migrations (#455), frozen by `./SPEC.md`
// §1.6. Runtime behavior is in `migrations.spec.ts`; this file is compiled by
// `node scripts/typecheck.mjs`.
//
// `@ts-expect-error` is the type-level analogue of `it.fails`: every directive
// is live at dafe6b79 and becomes TS2578-unused when its frozen claim lands.

import type { Equal, Expect } from '@zmdb/schema-core';

import type {
  ChangeOp,
  diff,
  // @ts-expect-error TS2305 — frozen by SPEC.md 1.6; not exported yet.
  ForeignKeySnapshot,
  TableSnapshot,
} from './index.js';

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

// @ts-expect-error TS2344 — ForeignKeySnapshot is an error type until the export lands.
export type _ForeignKeySnapshotShape = Expect<Equal<ForeignKeySnapshot, FrozenForeignKeySnapshot>>;

// Required, with [] as the only spelling of "no foreign keys".
// @ts-expect-error frozen (SPEC.md 1.6): TableSnapshot gains foreignKeys.
type TableForeignKeys = TableSnapshot['foreignKeys'];
export type _ForeignKeysOnTable = Expect<Equal<TableForeignKeys, readonly FrozenForeignKeySnapshot[]>>;

// @ts-expect-error frozen (SPEC.md 1.6): ChangeOp gains add_foreign_key.
export type _AddForeignKeyOp = Expect<Equal<Extract<ChangeOp, { kind: 'add_foreign_key' }>, FrozenAddForeignKey>>;

// @ts-expect-error frozen (SPEC.md 1.6): ChangeOp gains drop_foreign_key.
export type _DropForeignKeyOp = Expect<Equal<Extract<ChangeOp, { kind: 'drop_foreign_key' }>, FrozenDropForeignKey>>;

type CreateTable = Extract<ChangeOp, { kind: 'create_table' }>;

// SQLite's inline golden is impossible unless create_table carries the table's
// constraints. This is the smallest correction to the frozen ChangeOp surface.
// @ts-expect-error frozen (SPEC.md 1.6, corrected): create_table carries foreignKeys.
type CreateTableForeignKeys = CreateTable['foreignKeys'];
export type _CreateTableCarriesForeignKeys = Expect<Equal<CreateTableForeignKeys, readonly FrozenForeignKeySnapshot[]>>;

// SQLite action changes and mutual-reference cycles need before/after plan
// context. The two frozen drop/add ops do not carry that context, so the
// dialect is an optional diff input rather than an invented third op.
// @ts-expect-error frozen (SPEC.md 1.6, corrected): diff has a dialect option.
type DiffOptions = Parameters<typeof diff>[2];
type DiffDialect = NonNullable<DiffOptions>['dialect'];
type FrozenDiffDialect = 'postgres' | 'mysql' | 'sqlite' | undefined;
// @ts-expect-error TS2344 — DiffOptions is an error type until the option lands.
export type _DiffDialect = Expect<Equal<DiffDialect, FrozenDiffDialect>>;
