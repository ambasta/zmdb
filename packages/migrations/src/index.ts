// Migrations (#41–#44): snapshot a set of schemas, diff two snapshots into
// change ops, and emit up/down DDL per dialect. Deterministic throughout —
// tables and columns are sorted by name so a snapshot is byte-stable.
import {
  UnsupportedFeatureError,
  dialectName,
  type ChangeOp,
  type ColumnSnapshot,
  type ExtensionSnapshot,
  type ExtensionType,
  type ForeignKeySnapshot,
  type MigrationDialect,
  type ReferentialAction,
  type SchemaSnapshot,
  type SchemaObjectOperation,
  type SqlDialect,
  type TableOptions,
  type TableSnapshot,
} from '@zmdb/query-compiler';
import { ddlType, type DdlSqlType } from '@zmdb/query-compiler/schema-objects';

export type {
  ChangeOp,
  ColumnSnapshot,
  ExtensionSnapshot,
  ExtensionType,
  ForeignKeySnapshot,
  ReferentialAction,
  SchemaSnapshot,
  SqlDialect,
  TableOptions,
  TableSnapshot,
} from '@zmdb/query-compiler';
export type { MigrationDialect, SchemaObjectOperation } from '@zmdb/query-compiler';
export { ddlType };
export type { DdlSqlType };
export {
  down,
  downTo,
  driverMigrationConnection,
  ensureVersionTable,
  rollbackTo,
  runCli,
  status,
  up,
} from './runner.js';
export type {
  AppliedMigration,
  Migration,
  MigrationConnection,
  MigrationDriver,
  MigrationRunOptions,
  MigrationStatus,
  MigrationTableOptions,
} from './runner.js';
export type { MigrationProject } from './project.js';

function migrationsOf(target: SqlDialect | MigrationDialect): MigrationDialect {
  return 'migrations' in target ? target.migrations : target;
}

export function emitSchemaObject(
  operation: SchemaObjectOperation,
  target: SqlDialect | MigrationDialect,
): readonly string[] {
  return migrationsOf(target).emitSchemaObject(operation);
}
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
  readonly primaryKey: readonly string[];
  readonly columns: Readonly<
    Record<
      string,
      {
        readonly type: string | ExtensionType;
        readonly flags: {
          readonly nullable: boolean;
          readonly primaryKey?: boolean | undefined;
          readonly length?: number | undefined;
          readonly unique?: boolean | undefined;
          readonly hasDefault?: boolean | undefined;
        };
        readonly default?: unknown;
        readonly references?: { readonly target: string } | undefined;
      }
    >
  >;
  readonly ir?: {
    readonly table: string;
    readonly physicalTable?: string;
    readonly columns: readonly {
      readonly name: string;
      readonly physicalName?: string;
      readonly references?: string;
      readonly onDelete?: ReferentialAction;
      readonly onUpdate?: ReferentialAction;
    }[];
    readonly foreignKeys?: readonly {
      readonly columns: readonly string[];
      readonly targetTable: string;
      readonly targetColumns: readonly string[];
    }[];
    readonly tableOptions?: TableOptions;
  };
}

function generatedForeignKeyName(table: string, columns: readonly string[]): string {
  const name = `${table}_${columns.join('_')}_fkey`;
  if (name.length > 63) {
    throw new TypeError(
      `generated foreign key name "${name}" is ${name.length} characters long; PostgreSQL's limit is 63, ` +
        'so give the table or columns shorter names',
    );
  }
  return name;
}

function referencedTarget(target: string): { readonly table: string; readonly column: string } {
  const separator = target.indexOf('.');
  if (separator <= 0 || separator !== target.lastIndexOf('.') || separator === target.length - 1) {
    throw new TypeError(`foreign key target "${target}" must be written as "table.column"`);
  }
  return { table: target.slice(0, separator), column: target.slice(separator + 1) };
}

function physicalColumn(schema: SnapshotableSchema, declared: string): string {
  const column = schema.ir?.columns.find(candidate => candidate.name === declared);
  return column?.physicalName ?? declared;
}

function physicalTarget(
  target: string,
  schemasByDeclaredTable: ReadonlyMap<string, SnapshotableSchema>,
): { readonly table: string; readonly column: string } {
  const declared = referencedTarget(target);
  const schema = schemasByDeclaredTable.get(declared.table);
  return schema === undefined
    ? declared
    : {
        table: schema.table,
        column: physicalColumn(schema, declared.column),
      };
}

function physicalTableOptions(schema: SnapshotableSchema): TableOptions | undefined {
  const options = schema.ir?.tableOptions;
  if (options === undefined) return undefined;
  return {
    ...(options.shardKey === undefined
      ? {}
      : { shardKey: options.shardKey.map(column => physicalColumn(schema, column)) }),
    ...(options.sortKey === undefined
      ? {}
      : { sortKey: options.sortKey.map(column => physicalColumn(schema, column)) }),
    ...(options.rowstore === undefined ? {} : { rowstore: options.rowstore }),
  };
}

export function snapshot(schemas: readonly SnapshotableSchema[]): SchemaSnapshot {
  const schemasByDeclaredTable = new Map(schemas.map(schema => [schema.ir?.table ?? schema.table, schema] as const));
  const extensions = new Map<string, ExtensionSnapshot>();
  const tables: TableSnapshot[] = schemas
    .map(schema => {
      const irColumns = new Map(
        schema.ir?.columns.flatMap(column => [
          [column.name, column] as const,
          [column.physicalName ?? column.name, column] as const,
        ]) ?? [],
      );
      const columns: ColumnSnapshot[] = Object.entries(schema.columns)
        .map(([name, meta]) => {
          if (typeof meta.type !== 'string') {
            extensions.set(meta.type.extension, { name: meta.type.extension });
          }
          const ir = irColumns.get(name);
          return {
            name: ir?.physicalName ?? name,
            type: meta.type,
            nullable: meta.flags.nullable,
            primaryKey: meta.flags.primaryKey === true,
            // Written only when there is one, so columns that are not `varchar` do not
            // acquire a meaningless field in the version-1 snapshot.
            ...(meta.flags.length === undefined ? {} : { length: meta.flags.length }),
            ...(meta.flags.unique === true ? { unique: true } : {}),
            ...(meta.default !== undefined ? { default: meta.default } : {}),
            ...(meta.references ? { references: { target: meta.references.target } } : {}),
          };
        })
        .toSorted((a, b) => a.name.localeCompare(b.name));
      const foreignKeys: ForeignKeySnapshot[] = [];
      for (const [name, meta] of Object.entries(schema.columns)) {
        if (meta.references === undefined) continue;
        const target = physicalTarget(meta.references.target, schemasByDeclaredTable);
        const ir = irColumns.get(name);
        const localName = ir?.physicalName ?? name;
        foreignKeys.push({
          name: generatedForeignKeyName(schema.table, [localName]),
          columns: [localName],
          targetTable: target.table,
          targetColumns: [target.column],
          onDelete: ir?.onDelete ?? 'no action',
          onUpdate: ir?.onUpdate ?? 'no action',
        });
      }
      for (const foreignKey of schema.ir?.foreignKeys ?? []) {
        const localColumns = foreignKey.columns.map(column => physicalColumn(schema, column));
        const targetSchema = schemasByDeclaredTable.get(foreignKey.targetTable);
        foreignKeys.push({
          name: generatedForeignKeyName(schema.table, localColumns),
          columns: localColumns,
          targetTable: targetSchema?.table ?? foreignKey.targetTable,
          targetColumns:
            targetSchema === undefined
              ? foreignKey.targetColumns
              : foreignKey.targetColumns.map(column => physicalColumn(targetSchema, column)),
          onDelete: 'no action',
          onUpdate: 'no action',
        });
      }
      const tableOptions = physicalTableOptions(schema);
      return {
        name: schema.table,
        columns,
        primaryKey: schema.primaryKey.map(column => physicalColumn(schema, column)),
        foreignKeys: foreignKeys.toSorted((a, b) => a.name.localeCompare(b.name)),
        ...(tableOptions === undefined ? {} : { tableOptions }),
      };
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
  ['drop_foreign_key'],
  ['drop_table'],
  ['create_table', 'add_column'],
  ['alter_column_type', 'alter_column_default', 'alter_column_unique', 'alter_column_references', 'alter_primary_key'],
  ['drop_column'],
  ['add_foreign_key'],
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

function sameSequence(previous: readonly string[], next: readonly string[]): boolean {
  return previous.length === next.length && previous.every((value, index) => value === next[index]);
}

function sameTableOptions(previous: TableOptions | undefined, next: TableOptions | undefined): boolean {
  if (previous?.rowstore !== next?.rowstore) return false;
  return (
    sameSequence(previous?.shardKey ?? [], next?.shardKey ?? []) &&
    sameSequence(previous?.sortKey ?? [], next?.sortKey ?? [])
  );
}

function foreignKeysOf(table: TableSnapshot): readonly ForeignKeySnapshot[] {
  // Stored snapshots written before referential actions landed have no field.
  // Reading them as [] lets the first post-upgrade diff add the declared constraints
  // instead of failing while loading the migration history.
  return table.foreignKeys ?? [];
}

function foreignKeyIdentity(foreignKey: ForeignKeySnapshot): string {
  return JSON.stringify([foreignKey.columns, foreignKey.targetTable, foreignKey.targetColumns]);
}

function sameForeignKeyActions(previous: ForeignKeySnapshot, next: ForeignKeySnapshot): boolean {
  return previous.onDelete === next.onDelete && previous.onUpdate === next.onUpdate;
}

function diffForeignKeys(
  table: string,
  previous: readonly ForeignKeySnapshot[],
  next: readonly ForeignKeySnapshot[],
  ops: ChangeOp[],
): void {
  const unmatchedPrevious = new Map(previous.map(foreignKey => [foreignKeyIdentity(foreignKey), foreignKey]));

  for (const foreignKey of next) {
    const identity = foreignKeyIdentity(foreignKey);
    const before = unmatchedPrevious.get(identity);
    if (before === undefined) {
      ops.push({ kind: 'add_foreign_key', table, fk: foreignKey });
      continue;
    }
    unmatchedPrevious.delete(identity);
    if (sameForeignKeyActions(before, foreignKey)) continue;
    ops.push({ kind: 'drop_foreign_key', table, name: before.name });
    ops.push({ kind: 'add_foreign_key', table, fk: foreignKey });
  }

  for (const foreignKey of unmatchedPrevious.values()) {
    ops.push({ kind: 'drop_foreign_key', table, name: foreignKey.name });
  }
}

function createdTablesInOrder(
  previous: ReadonlyMap<string, TableSnapshot>,
  next: readonly TableSnapshot[],
  dialect: SqlDialect | undefined,
): readonly TableSnapshot[] {
  const created = new Map(next.filter(table => !previous.has(table.name)).map(table => [table.name, table]));
  const dependencies = new Map<string, Set<string>>();
  const dependants = new Map<string, Set<string>>();

  for (const table of created.values()) {
    const targets = new Set(
      foreignKeysOf(table)
        .map(foreignKey => foreignKey.targetTable)
        .filter(target => target !== table.name && created.has(target)),
    );
    dependencies.set(table.name, targets);
    for (const target of targets) {
      const children = dependants.get(target) ?? new Set<string>();
      children.add(table.name);
      dependants.set(target, children);
    }
  }

  const ready = [...created.keys()]
    .filter(name => dependencies.get(name)?.size === 0)
    .toSorted((left, right) => left.localeCompare(right));
  const ordered: TableSnapshot[] = [];
  while (ready.length > 0) {
    const name = ready.shift();
    if (name === undefined) break;
    const table = created.get(name);
    if (table !== undefined) ordered.push(table);
    for (const child of dependants.get(name) ?? []) {
      const remaining = dependencies.get(child);
      remaining?.delete(name);
      if (remaining?.size === 0) {
        ready.push(child);
        ready.sort((left, right) => left.localeCompare(right));
      }
    }
  }

  if (ordered.length === created.size) return ordered;
  const orderedNames = new Set(ordered.map(table => table.name));
  const cyclic = [...created.keys()]
    .filter(name => !orderedNames.has(name))
    .toSorted((left, right) => left.localeCompare(right));
  if (dialect?.migrations.foreignKeyMode === 'inline') {
    const databaseName = dialectName(dialect);
    throw new UnsupportedFeatureError(
      `creating mutually-referencing tables ${cyclic.map(tableName => `"${tableName}"`).join(', ')}`,
      databaseName,
      `${databaseName} cannot create the mutually-referencing tables ${cyclic
        .map(tableName => `"${tableName}"`)
        .join(' and ')}; ` +
        'their foreign keys must be inline, so neither table can be created before the other — ' +
        'use a hand-written table rebuild or remove the cycle',
    );
  }
  return [...ordered, ...cyclic.map(name => created.get(name)).filter(table => table !== undefined)];
}

export interface DiffOptions {
  readonly dialect?: SqlDialect | undefined;
}

export interface MigrationPlan {
  readonly operations: readonly ChangeOp[];
  readonly up: readonly string[];
  readonly down: readonly string[];
}

export interface MigrationPlanDialect {
  readonly dialect: SqlDialect;
  emitUp(operation: ChangeOp): string;
  emitDown(operation: ChangeOp): string;
}

export function diff(prev: SchemaSnapshot, next: SchemaSnapshot, options: DiffOptions = {}): readonly ChangeOp[] {
  const selectedDialect = options.dialect;
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
    if (!nextTables.has(t.name)) {
      ops.push({ kind: 'drop_table', table: t.name, columns: t.columns });
    }
  }
  // Column-level and foreign-key diffs on tables that already exist.
  for (const t of next.tables) {
    const before = prevTables.get(t.name);
    if (!before) continue;
    if (!sameTableOptions(before.tableOptions, t.tableOptions)) {
      const target = selectedDialect === undefined ? 'the selected migration dialect' : dialectName(selectedDialect);
      throw new UnsupportedFeatureError(
        'table options change',
        target,
        `${target} cannot alter the shard key, sort key, or rowstore setting of "${t.name}"; ` +
          'create a replacement table and copy the data',
      );
    }
    const beforeCols = new Map(before.columns.map(c => [c.name, c]));
    const afterCols = new Map(t.columns.map(c => [c.name, c]));
    for (const c of before.columns) {
      if (!afterCols.has(c.name)) {
        ops.push({ kind: 'drop_column', table: t.name, column: c });
      }
    }
    for (const c of t.columns) {
      const bc = beforeCols.get(c.name);
      if (!bc) {
        ops.push({ kind: 'add_column', table: t.name, column: c });
      } else {
        if (!sameType(bc.type, c.type)) {
          ops.push({
            kind: 'alter_column_type',
            table: t.name,
            column: c.name,
            from: bc.type,
            to: c.type,
            fromNullable: bc.nullable,
            toNullable: c.nullable,
          });
        }
        if (bc.default !== c.default) {
          ops.push({ kind: 'alter_column_default', table: t.name, column: c.name, from: bc.default, to: c.default });
        }
        if (Boolean(bc.unique) !== Boolean(c.unique)) {
          ops.push({ kind: 'alter_column_unique', table: t.name, column: c.name, from: bc.unique, to: c.unique });
        }
        if (bc.references?.target !== c.references?.target) {
          ops.push({
            kind: 'alter_column_references',
            table: t.name,
            column: c.name,
            from: bc.references,
            to: c.references,
          });
        }
      }
    }
    if (!sameSequence(before.primaryKey, t.primaryKey)) {
      ops.push({ kind: 'alter_primary_key', table: t.name, from: before.primaryKey, to: t.primaryKey });
    }
    diffForeignKeys(t.name, foreignKeysOf(before), foreignKeysOf(t), ops);
  }

  // Created tables are target-before-child for inline constraints. Deferred
  // strategies get the same deterministic order before their ALTER statements.
  for (const table of createdTablesInOrder(prevTables, next.tables, selectedDialect)) {
    const foreignKeys = foreignKeysOf(table);
    ops.push({
      kind: 'create_table',
      table: table.name,
      columns: table.columns,
      primaryKey: table.primaryKey,
      foreignKeys,
      ...(table.tableOptions === undefined ? {} : { tableOptions: table.tableOptions }),
    });
    if (selectedDialect?.migrations.foreignKeyMode !== 'inline') {
      for (const foreignKey of foreignKeys) {
        ops.push({ kind: 'add_foreign_key', table: table.name, fk: foreignKey });
      }
    }
  }
  const operations = orderChanges(ops);
  selectedDialect?.migrations.validatePlan({
    before: prev,
    after: next,
    operations,
  });
  return operations;
}

export function planMigration(
  previous: SchemaSnapshot,
  next: SchemaSnapshot,
  database: MigrationPlanDialect,
): MigrationPlan {
  const operations = diff(previous, next, { dialect: database.dialect });
  return {
    operations,
    up: operations.map(operation => database.emitUp(operation)),
    down: operations.toReversed().map(operation => database.emitDown(operation)),
  };
}

// Database packages own every DDL spelling; this package only delegates the planned operation.
export function emitUp(operation: ChangeOp, target: SqlDialect | MigrationDialect): string {
  return migrationsOf(target).emitUp(operation);
}

export function emitDown(operation: ChangeOp, target: SqlDialect | MigrationDialect): string {
  return migrationsOf(target).emitDown(operation);
}
