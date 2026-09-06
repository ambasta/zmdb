import { dialectFamily, type DialectTarget } from '../index.js';
import {
  diff,
  type ChangeOp,
  type ColumnSnapshot,
  type SchemaSnapshot,
  type TableSnapshot,
} from '../migrations/index.js';
import { tableSelected, type CatalogForeignKeySnapshot, type CatalogIndexSnapshot } from './common.js';

export interface DriftOptions {
  /**
   * Table-name globs to omit. When absent, the migration ledger is omitted.
   * Supplying the list replaces that default, matching introspection selection.
   */
  readonly exclude?: readonly string[];
  /**
   * Enables dialect-owned noise rules. MySQL may create an otherwise undeclared
   * btree index solely to support a foreign key.
   */
  readonly dialect?: DialectTarget;
}

export interface DriftReport {
  /** Operations that transform the declared snapshot into the live database shape. */
  readonly onlyInDatabase: readonly ChangeOp[];
  /** Operations that transform the live database snapshot into the declared shape. */
  readonly onlyInDeclarations: readonly ChangeOp[];
  readonly clean: boolean;
}

type DriftColumnSnapshot = ColumnSnapshot & {
  readonly catalogType?: string;
  readonly default?: string;
};

interface DriftTableSnapshot extends Omit<TableSnapshot, 'columns' | 'foreignKeys'> {
  readonly columns: readonly DriftColumnSnapshot[];
  readonly foreignKeys?: readonly CatalogForeignKeySnapshot[];
  readonly indexes?: readonly CatalogIndexSnapshot[];
}

interface DriftComparableSnapshot extends Omit<SchemaSnapshot, 'tables'> {
  readonly tables: readonly DriftTableSnapshot[];
}

interface NormalizedDriftTableSnapshot extends Omit<TableSnapshot, 'foreignKeys'> {
  readonly foreignKeys: readonly CatalogForeignKeySnapshot[];
  readonly indexes?: readonly CatalogIndexSnapshot[];
}

interface NormalizedDriftSnapshot extends Omit<SchemaSnapshot, 'tables'> {
  readonly tables: readonly NormalizedDriftTableSnapshot[];
}

type SnapshotRole = 'live' | 'declared';

function normalizeColumn(column: DriftColumnSnapshot): ColumnSnapshot {
  return {
    name: column.name,
    type: column.type,
    nullable: column.nullable,
    primaryKey: column.primaryKey,
    ...(column.length === undefined ? {} : { length: column.length }),
    ...(column.unique === undefined ? {} : { unique: column.unique }),
  };
}

function sameColumns(index: CatalogIndexSnapshot, foreignKey: CatalogForeignKeySnapshot): boolean {
  if (index.columns.length !== foreignKey.columns.length) return false;
  return index.columns.every((column, position) => {
    const expected = foreignKey.columns[position];
    return typeof column === 'string' && column === expected;
  });
}

function isMySqlForeignKeySupportingIndex(
  index: CatalogIndexSnapshot,
  foreignKeys: readonly CatalogForeignKeySnapshot[],
): boolean {
  if (index.unique || index.where !== undefined) return false;
  if (index.method !== undefined && index.method.toLowerCase() !== 'btree') return false;

  return foreignKeys.some(
    foreignKey =>
      (index.name === foreignKey.name || index.name === `${foreignKey.name}_idx`) && sameColumns(index, foreignKey),
  );
}

function normalizeIndexes(
  table: DriftTableSnapshot,
  role: SnapshotRole,
  dialect: DialectTarget | undefined,
): readonly CatalogIndexSnapshot[] | undefined {
  if (table.indexes === undefined) return undefined;
  if (role !== 'live' || dialect === undefined || dialectFamily(dialect) !== 'mysql') return table.indexes;
  const foreignKeys = table.foreignKeys ?? [];
  return table.indexes.filter(index => !isMySqlForeignKeySupportingIndex(index, foreignKeys));
}

/**
 * Internal normalization boundary used before both calls to the migration diff.
 *
 * Exported from the introspection subpath as the vendor-neutral normalization seam
 * used by independently shipped database introspectors.
 */
export function normalizeDriftSnapshot(
  snapshot: SchemaSnapshot,
  role: SnapshotRole,
  options: DriftOptions = {},
): NormalizedDriftSnapshot {
  const comparable: DriftComparableSnapshot = snapshot;
  const selection = options.exclude === undefined ? {} : { exclude: options.exclude };
  const tables = comparable.tables
    .filter(table => tableSelected(table.name, selection))
    .map(table => {
      const indexes = normalizeIndexes(table, role, options.dialect);
      const normalized: NormalizedDriftTableSnapshot = {
        name: table.name,
        // Catalog spellings and default expressions are evidence, not drift:
        // aliases have already collapsed into `type`, and servers rewrite defaults.
        columns: table.columns.map(normalizeColumn),
        primaryKey: table.primaryKey,
        foreignKeys: table.foreignKeys ?? [],
        ...(table.tableOptions === undefined ? {} : { tableOptions: table.tableOptions }),
        ...(indexes === undefined ? {} : { indexes }),
      };
      return normalized;
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));

  return {
    version: 1,
    tables,
    extensions: snapshot.extensions.toSorted((left, right) => left.name.localeCompare(right.name)),
  };
}

/**
 * Compare an introspected snapshot and declared snapshot through the migration
 * comparator in both directions.
 */
export function detectDrift(live: SchemaSnapshot, declared: SchemaSnapshot, options: DriftOptions = {}): DriftReport {
  const normalizedLive = normalizeDriftSnapshot(live, 'live', options);
  const normalizedDeclared = normalizeDriftSnapshot(declared, 'declared', options);
  const onlyInDatabase = diff(normalizedDeclared, normalizedLive, { dialect: options.dialect });
  const onlyInDeclarations = diff(normalizedLive, normalizedDeclared, { dialect: options.dialect });

  return {
    onlyInDatabase,
    onlyInDeclarations,
    clean: onlyInDatabase.length === 0 && onlyInDeclarations.length === 0,
  };
}
