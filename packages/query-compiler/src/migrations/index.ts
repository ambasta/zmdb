// Migrations (#41–#44): snapshot a set of schemas, diff two snapshots into
// change ops, and emit up/down DDL per dialect. Deterministic throughout —
// tables and columns are sorted by name so a snapshot is byte-stable.
export * from './runner.js';
import { UnsupportedFeatureError } from '../errors.js';
import type { Dialect } from '../index.js';
import { quoteIdentifier } from '../quoting.js';
import { createExtensionDdl } from '../schema-objects/extensions.js';

export interface ExtensionType {
  readonly extension: string;
  readonly name: string;
  readonly args?: readonly (string | number)[];
}

export interface ColumnSnapshot {
  readonly name: string;
  /**
   * The **abstract** column type — `'timestamp'`, not `'TIMESTAMPTZ'`.
   *
   * A snapshot is a record of what the schema says, so it must not name a dialect: the
   * same snapshot is diffed and then emitted for Postgres, MySQL and SQLite. `ddlType`
   * below is where it becomes a real one.
   */
  readonly type: string | ExtensionType;
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
  readonly extensions: readonly ExtensionSnapshot[];
}

export interface ExtensionSnapshot {
  readonly name: string;
  readonly schema?: string;
}

export type ChangeOp =
  | { readonly kind: 'create_extension'; readonly name: string; readonly schema?: string }
  | { readonly kind: 'create_table'; readonly table: string; readonly columns: readonly ColumnSnapshot[] }
  | { readonly kind: 'drop_table'; readonly table: string }
  | { readonly kind: 'add_column'; readonly table: string; readonly column: ColumnSnapshot }
  | { readonly kind: 'drop_column'; readonly table: string; readonly column: string }
  | {
      readonly kind: 'alter_column_type';
      readonly table: string;
      readonly column: string;
      readonly from: string | ExtensionType;
      readonly to: string | ExtensionType;
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
        readonly type: string | ExtensionType;
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
  const extensions = new Map<string, ExtensionSnapshot>();
  const tables: TableSnapshot[] = schemas
    .map(schema => {
      const columns: ColumnSnapshot[] = Object.entries(schema.columns)
        .map(([name, meta]) => {
          if (typeof meta.type !== 'string') {
            extensions.set(meta.type.extension, { name: meta.type.extension });
          }
          return {
            name,
            type: meta.type,
            nullable: meta.flags.nullable,
            primaryKey: meta.flags.primaryKey === true,
            // Written only when there is one, so columns that are not `varchar` do not
            // acquire a meaningless field in the version-1 snapshot.
            ...(meta.flags.length === undefined ? {} : { length: meta.flags.length }),
          };
        })
        .toSorted((a, b) => a.name.localeCompare(b.name));
      return { name: schema.table, columns };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));

  return {
    version: 1,
    tables,
    extensions: [...extensions.values()].toSorted((a, b) => a.name.localeCompare(b.name)),
  };
}

function sameType(previous: string | ExtensionType, next: string | ExtensionType): boolean {
  if (typeof previous === 'string' || typeof next === 'string') return previous === next;
  if (previous.extension !== next.extension || previous.name !== next.name) return false;
  const previousArgs = previous.args ?? [];
  const nextArgs = next.args ?? [];
  return previousArgs.length === nextArgs.length && previousArgs.every((value, index) => value === nextArgs[index]);
}

export const CHANGE_PHASES = [
  ['create_extension'],
  ['drop_table', 'drop_column'],
  ['create_table', 'add_column'],
  ['alter_column_type'],
] as const satisfies readonly (readonly ChangeOp['kind'][])[];

const CHANGE_PHASE = new Map<ChangeOp['kind'], number>(
  CHANGE_PHASES.flatMap((kinds, phase) => kinds.map(kind => [kind, phase] as const)),
);

function orderChanges(ops: readonly ChangeOp[]): readonly ChangeOp[] {
  const phaseOf = (kind: ChangeOp['kind']): number => {
    const phase = CHANGE_PHASE.get(kind);
    if (phase === undefined) throw new Error(`change kind "${kind}" has no migration phase`);
    return phase;
  };
  return ops.toSorted((left, right) => phaseOf(left.kind) - phaseOf(right.kind));
}

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot): readonly ChangeOp[] {
  const ops: ChangeOp[] = [];
  const prevTables = new Map(prev.tables.map(t => [t.name, t]));
  const nextTables = new Map(next.tables.map(t => [t.name, t]));
  const prevExtensions = new Set(prev.extensions.map(extension => extension.name));

  for (const extension of next.extensions) {
    if (!prevExtensions.has(extension.name)) {
      ops.push({
        kind: 'create_extension',
        name: extension.name,
        ...(extension.schema === undefined ? {} : { schema: extension.schema }),
      });
    }
  }

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
      } else if (!sameType(bc.type, c.type)) {
        ops.push({ kind: 'alter_column_type', table: t.name, column: c.name, from: bc.type, to: c.type });
      }
    }
  }
  return orderChanges(ops);
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
export const DDL_TYPES = {
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
} as const satisfies Readonly<Record<Dialect, Readonly<Record<string, string>>>>;

export type DdlSqlType = keyof (typeof DDL_TYPES)['postgres'];

function ddlScalarType(dialect: Dialect, type: string): string {
  const types: Readonly<Record<string, string>> = DDL_TYPES[dialect];
  return types[type] ?? type;
}

const EXTENSION_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function extensionTypeDdl(type: ExtensionType): string {
  if (!EXTENSION_IDENTIFIER.test(type.name)) {
    throw new TypeError(`extension type name ${JSON.stringify(type.name)} is not a SQL identifier`);
  }
  const args = type.args ?? [];
  const rendered = args.map(argument => {
    if (typeof argument === 'number' && Number.isFinite(argument)) return String(argument);
    if (typeof argument === 'string' && EXTENSION_IDENTIFIER.test(argument)) return argument;
    throw new TypeError(
      `extension type ${type.name} argument ${JSON.stringify(argument)} must be a finite number or SQL identifier`,
    );
  });
  return `${type.name}${rendered.length === 0 ? '' : `(${rendered.join(',')})`}`;
}

function unsupportedExtensionType(
  dialect: Dialect,
  type: ExtensionType,
  column: string,
  table?: string,
): UnsupportedFeatureError {
  const rendered = extensionTypeDdl(type);
  const location = table === undefined ? `column "${column}"` : `"${table}"."${column}"`;
  return new UnsupportedFeatureError(
    `extension type ${rendered}`,
    dialect,
    `${dialect} does not support the extension type ${rendered} on ${location} (extension \`${type.extension}\`); ` +
      'there is no equivalent, and storing it as TEXT would produce a value the database cannot use',
  );
}

/**
 * The dialect's spelling of an abstract type or one column's complete type.
 *
 * A bare type is for a routine signature. `serial` then means its underlying
 * integer type, because auto-generation is a column property. A column snapshot
 * additionally carries length, key and auto-increment semantics.
 *
 * Exported because a migration written by hand is still a migration, and the answer to
 * "what does this dialect call a `timestamp`" should have exactly one implementation.
 */
export function ddlType(dialect: Dialect, type: string): string;
export function ddlType(dialect: Dialect, column: ColumnSnapshot): string;
export function ddlType(dialect: Dialect, typeOrColumn: string | ColumnSnapshot): string {
  const isColumn = typeof typeOrColumn !== 'string';
  const column = isColumn ? typeOrColumn : undefined;
  const type = isColumn ? typeOrColumn.type : typeOrColumn === 'serial' ? 'integer' : typeOrColumn;
  if (typeof type !== 'string') {
    if (dialect !== 'postgres') throw unsupportedExtensionType(dialect, type, column?.name ?? 'unknown');
    return extensionTypeDdl(type);
  }
  const mapped = ddlScalarType(dialect, type);

  // A length belongs to the type, not to the column: `VARCHAR(255)`, not `VARCHAR 255`.
  // Only where the dialect has a parameterised type to put it in — SQLite maps `varchar`
  // to `TEXT`, which takes none. A Postgres `VARCHAR` with no length is unlimited and
  // legal; a MySQL one is a syntax error, so it degrades to `TEXT` rather than emitting
  // DDL that cannot run.
  if (type === 'varchar') {
    if (column?.length !== undefined && mapped === 'VARCHAR') return `VARCHAR(${column.length})`;
    if (dialect === 'mysql') return 'TEXT';
    return mapped;
  }

  // `AUTO_INCREMENT` is part of the column definition in MySQL rather than a type, and
  // MySQL requires such a column to be keyed. It is the primary key in every schema the
  // DSL can build but one — a non-primary `serial()` is legal — so the unique key is
  // spelled out in that case instead of quietly dropping the auto-increment.
  if (column?.type === 'serial' && dialect === 'mysql') {
    return column.primaryKey ? 'INT AUTO_INCREMENT' : 'INT AUTO_INCREMENT UNIQUE';
  }

  return mapped;
}

function columnDdl(d: Dialect, col: ColumnSnapshot, table: string): string {
  // PRIMARY KEY implies NOT NULL, so we don't emit both.
  const pk = col.primaryKey ? ' PRIMARY KEY' : '';
  const nn = !col.primaryKey && !col.nullable ? ' NOT NULL' : '';
  const type =
    typeof col.type === 'string'
      ? ddlType(d, col)
      : d === 'postgres'
        ? extensionTypeDdl(col.type)
        : (() => {
            throw unsupportedExtensionType(d, col.type, col.name, table);
          })();
  return `${quoteIdentifier(d, col.name)} ${type}${pk}${nn}`;
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
function alteredType(dialect: Dialect, table: string, column: string, type: string | ExtensionType): string {
  if (typeof type !== 'string' && dialect !== 'postgres') {
    throw unsupportedExtensionType(dialect, type, column, table);
  }
  return ddlType(dialect, { name: column, type, nullable: true, primaryKey: false });
}

export function emitUp(op: ChangeOp, dialect: Dialect): string {
  switch (op.kind) {
    case 'create_extension':
      return createExtensionDdl(op, dialect);
    case 'create_table':
      return `CREATE TABLE ${quoteIdentifier(dialect, op.table)} (${op.columns.map(c => columnDdl(dialect, c, op.table)).join(', ')})`;
    case 'drop_table':
      return `DROP TABLE ${quoteIdentifier(dialect, op.table)}`;
    case 'add_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ADD COLUMN ${columnDdl(dialect, op.column, op.table)}`;
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} DROP COLUMN ${quoteIdentifier(dialect, op.column)}`;
    case 'alter_column_type':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ALTER COLUMN ${quoteIdentifier(dialect, op.column)} TYPE ${alteredType(dialect, op.table, op.column, op.to)}`;
  }
}

export function emitDown(op: ChangeOp, dialect: Dialect): string {
  switch (op.kind) {
    case 'create_extension':
      throw new Error(
        `extension "${op.name}" is not dropped automatically; write a hand-authored migration after checking dependants`,
      );
    case 'create_table':
      return `DROP TABLE ${quoteIdentifier(dialect, op.table)}`;
    case 'drop_table':
      return `CREATE TABLE ${quoteIdentifier(dialect, op.table)} ()`;
    case 'add_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} DROP COLUMN ${quoteIdentifier(dialect, op.column.name)}`;
    case 'drop_column':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ADD COLUMN ${quoteIdentifier(dialect, op.column)}`;
    case 'alter_column_type':
      return `ALTER TABLE ${quoteIdentifier(dialect, op.table)} ALTER COLUMN ${quoteIdentifier(dialect, op.column)} TYPE ${alteredType(dialect, op.table, op.column, op.from)}`;
  }
}
