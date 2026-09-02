// Migrations (#41–#44): snapshot a set of schemas, diff two snapshots into
// change ops, and emit up/down DDL per dialect. Deterministic throughout —
// tables and columns are sorted by name so a snapshot is byte-stable.
export * from './runner.ts';
import type { Dialect } from '../index.ts';
import { quoteIdentifier } from '../quoting.ts';

export interface ColumnSnapshot {
  readonly name: string;
  /**
   * The **abstract** column type — `'timestamp'`, not `'TIMESTAMPTZ'`.
   *
   * A snapshot is a record of what the schema says, so it must not name a dialect: the
   * same snapshot is diffed and then emitted for Postgres, MySQL and SQLite. `ddlType`
   * below is where it becomes a real one.
   */
  readonly type: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  /** `varchar(255)` → `255`. MySQL rejects a `VARCHAR` with no length. */
  readonly length?: number | undefined;
}

export interface TableSnapshot {
  readonly name: string;
  readonly columns: readonly ColumnSnapshot[];
}

export interface SchemaSnapshot {
  readonly version: 1;
  readonly tables: readonly TableSnapshot[];
}

export type ChangeOp =
  | { readonly kind: 'create_table'; readonly table: string; readonly columns: readonly ColumnSnapshot[] }
  | { readonly kind: 'drop_table'; readonly table: string }
  | { readonly kind: 'add_column'; readonly table: string; readonly column: ColumnSnapshot }
  | { readonly kind: 'drop_column'; readonly table: string; readonly column: string }
  | {
      readonly kind: 'alter_column_type';
      readonly table: string;
      readonly column: string;
      readonly from: string;
      readonly to: string;
    };

/**
 * The slice of a schema a snapshot reads.
 *
 * Declared structurally rather than importing `CoreSchema`: this package sits
 * *below* `@zmdb/schema-core` in the dependency DAG, and a `CoreSchema` satisfies
 * this shape by construction. It replaces a `schemas: readonly unknown[]`
 * parameter whose body immediately asserted this very type — i.e. an escape hatch
 * that moved the requirement out of the signature and into a comment.
 */
export interface SnapshotableSchema {
  readonly table: string;
  readonly columns: Readonly<
    Record<
      string,
      {
        readonly type: string;
        readonly flags: {
          readonly nullable: boolean;
          readonly primaryKey?: boolean | undefined;
          readonly length?: number | undefined;
        };
      }
    >
  >;
}

export function snapshot(schemas: readonly SnapshotableSchema[]): SchemaSnapshot {
  const tables: TableSnapshot[] = schemas
    .map(schema => {
      const columns: ColumnSnapshot[] = Object.entries(schema.columns)
        .map(([name, meta]) => ({
          name,
          type: meta.type,
          nullable: meta.flags.nullable,
          primaryKey: meta.flags.primaryKey === true,
          // Written only when there is one, so a snapshot of a schema with no `varchar`
          // is byte-identical to the one the previous version of this function produced.
          ...(meta.flags.length === undefined ? {} : { length: meta.flags.length }),
        }))
        .toSorted((a, b) => a.name.localeCompare(b.name));
      return { name: schema.table, columns };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));

  return { version: 1, tables };
}

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot): readonly ChangeOp[] {
  const ops: ChangeOp[] = [];
  const prevTables = new Map(prev.tables.map(t => [t.name, t]));
  const nextTables = new Map(next.tables.map(t => [t.name, t]));

  // Dropped tables.
  for (const t of prev.tables) {
    if (!nextTables.has(t.name)) ops.push({ kind: 'drop_table', table: t.name });
  }
  // Created tables + column-level diffs.
  for (const t of next.tables) {
    const before = prevTables.get(t.name);
    if (!before) {
      ops.push({ kind: 'create_table', table: t.name, columns: t.columns });
      continue;
    }
    const beforeCols = new Map(before.columns.map(c => [c.name, c]));
    const afterCols = new Map(t.columns.map(c => [c.name, c]));
    for (const c of before.columns) {
      if (!afterCols.has(c.name)) ops.push({ kind: 'drop_column', table: t.name, column: c.name });
    }
    for (const c of t.columns) {
      const bc = beforeCols.get(c.name);
      if (!bc) {
        ops.push({ kind: 'add_column', table: t.name, column: c });
      } else if (bc.type !== c.type) {
        ops.push({ kind: 'alter_column_type', table: t.name, column: c.name, from: bc.type, to: c.type });
      }
    }
  }
  return ops;
}

// ---------------------------------------------------------------------------
// The DDL type map.
// ---------------------------------------------------------------------------
//
// Until this existed, `columnDdl` interpolated the abstract type verbatim, so a
// `timestamp` reached all three databases as the literal word `timestamp`. Postgres
// reads that as `timestamp without time zone` and silently drops the offset of every
// `Date` written to it, MySQL rejects a `VARCHAR` with no length outright, and only the
// *identifiers* were ever dialect-aware. One column, three wrong answers.
//
// So each dialect renders the type it owns, and the abstract name stays abstract
// everywhere above this function. The keys are the `SqlType` vocabulary of
// `@zmdb/schema-core`, spelled as strings because this package sits *below* it in the
// dependency DAG and must not import it. A type not named here — a hand-written
// snapshot, a column type a future schema adds — is passed through unchanged, which is
// the only option that does not turn an unknown into a wrong guess.

/** What each dialect calls each abstract type, where the answer is a constant. */
const DDL_TYPES: Readonly<Record<Dialect, Readonly<Record<string, string>>>> = {
  postgres: {
    serial: 'SERIAL',
    integer: 'INTEGER',
    bigint: 'BIGINT',
    numeric: 'NUMERIC',
    text: 'TEXT',
    varchar: 'VARCHAR',
    boolean: 'BOOLEAN',
    // The whole reason this map exists. `TIMESTAMP` in Postgres means "without time
    // zone", which stores the wall clock and forgets the offset.
    timestamp: 'TIMESTAMPTZ',
    json: 'JSONB',
    jsonEnum: 'TEXT',
  },
  mysql: {
    serial: 'INT',
    integer: 'INT',
    bigint: 'BIGINT',
    numeric: 'DECIMAL',
    text: 'TEXT',
    varchar: 'VARCHAR',
    boolean: 'TINYINT(1)',
    // MySQL has no zone-aware type with a usable range: `TIMESTAMP` converts to the
    // session zone and stops in 2038. `DATETIME(3)` keeps the milliseconds a `Date` has,
    // and the application owns the zone — which is UTC, per the driver.
    timestamp: 'DATETIME(3)',
    json: 'JSON',
    jsonEnum: 'TEXT',
  },
  sqlite: {
    // SQLite has five affinities and no separate integer widths. `INTEGER PRIMARY KEY`
    // is the rowid alias, which is what makes a `serial` auto-increment here.
    serial: 'INTEGER',
    integer: 'INTEGER',
    bigint: 'INTEGER',
    numeric: 'NUMERIC',
    text: 'TEXT',
    varchar: 'TEXT',
    boolean: 'INTEGER',
    timestamp: 'TEXT',
    json: 'TEXT',
    jsonEnum: 'TEXT',
  },
};

/**
 * The dialect's spelling of one column's type, length and auto-increment included.
 *
 * Exported because a migration written by hand is still a migration, and the answer to
 * "what does this dialect call a `timestamp`" should have exactly one implementation.
 */
export function ddlType(dialect: Dialect, col: ColumnSnapshot): string {
  const mapped = DDL_TYPES[dialect][col.type] ?? col.type;

  // A length belongs to the type, not to the column: `VARCHAR(255)`, not `VARCHAR 255`.
  // Only where the dialect has a parameterised type to put it in — SQLite maps `varchar`
  // to `TEXT`, which takes none. A Postgres `VARCHAR` with no length is unlimited and
  // legal; a MySQL one is a syntax error, so it degrades to `TEXT` rather than emitting
  // DDL that cannot run.
  if (col.type === 'varchar') {
    if (col.length !== undefined && mapped === 'VARCHAR') return `VARCHAR(${col.length})`;
    if (dialect === 'mysql') return 'TEXT';
    return mapped;
  }

  // `AUTO_INCREMENT` is part of the column definition in MySQL rather than a type, and
  // MySQL requires such a column to be keyed. It is the primary key in every schema the
  // DSL can build but one — a non-primary `serial()` is legal — so the unique key is
  // spelled out in that case instead of quietly dropping the auto-increment.
  if (col.type === 'serial' && dialect === 'mysql') {
    return col.primaryKey ? 'INT AUTO_INCREMENT' : 'INT AUTO_INCREMENT UNIQUE';
  }

  return mapped;
}

function columnDdl(d: Dialect, col: ColumnSnapshot): string {
  // PRIMARY KEY implies NOT NULL, so we don't emit both.
  const pk = col.primaryKey ? ' PRIMARY KEY' : '';
  const nn = !col.primaryKey && !col.nullable ? ' NOT NULL' : '';
  return `${quoteIdentifier(d, col.name)} ${ddlType(d, col)}${pk}${nn}`;
}

/**
 * The dialect's spelling of a type named by an `alter_column_type` op.
 *
 * The op carries the two type names and nothing else, so two facts are unavailable here
 * and are not guessed at: a `varchar`'s length (which `diff` cannot see either — it
 * compares types, so `varchar(60)` → `varchar(120)` produces no op at all), and whether
 * the column is a key, which only matters for MySQL's `AUTO_INCREMENT`. Neither is
 * reachable by an `ALTER`: a change *to* `serial` is not something the diff can express.
 */
function alteredType(dialect: Dialect, column: string, type: string): string {
  return ddlType(dialect, { name: column, type, nullable: true, primaryKey: false });
}

export function emitUp(op: ChangeOp, dialect: Dialect): string {
  switch (op.kind) {
    case 'create_table':
      return `CREATE TABLE ${quoteIdentifier(dialect, op.table)} (${op.columns.map(c => columnDdl(dialect, c)).join(', ')})`;
    case 'drop_table':
      return `DROP TABLE ${quoteIdentifier(dialect, op.table)}`;
    case 'add_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ADD COLUMN ${columnDdl(dialect, op.column)}`;
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} DROP COLUMN ${quoteIdentifier(dialect, op.column)}`;
    case 'alter_column_type':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ALTER COLUMN ${quoteIdentifier(dialect, op.column)} TYPE ${alteredType(dialect, op.column, op.to)}`;
  }
}

export function emitDown(op: ChangeOp, dialect: Dialect): string {
  switch (op.kind) {
    case 'create_table':
      return `DROP TABLE ${quoteIdentifier(dialect, op.table)}`;
    case 'drop_table':
      return `CREATE TABLE ${quoteIdentifier(dialect, op.table)} ()`;
    case 'add_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} DROP COLUMN ${quoteIdentifier(dialect, op.column.name)}`;
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ADD COLUMN ${quoteIdentifier(dialect, op.column)}`;
    case 'alter_column_type':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ALTER COLUMN ${quoteIdentifier(dialect, op.column)} TYPE ${alteredType(dialect, op.column, op.from)}`;
  }
}
