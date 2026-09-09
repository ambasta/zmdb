import type { CoreSchema } from '@zmdb/schema';

import type { Predicate } from './clauses.js';
import type { AliasedColumn } from './index.js';

const TRUSTED_TABLE = Symbol('zmdb.trusted-table');

/** Explicit physical SQL target. It carries no declaration or inferred entity type. */
export interface TrustedTable {
  readonly [TRUSTED_TABLE]: true;
  readonly table: string;
  readonly ftsTable?: string | boolean | undefined;
}

export function trustedTable(
  table: string,
  options?: { readonly ftsTable?: string | boolean | undefined },
): TrustedTable {
  return Object.freeze({ [TRUSTED_TABLE]: true as const, table, ...options });
}

interface SchemaNames {
  readonly columns: ReadonlyMap<string, string>;
  readonly projection: readonly (string | AliasedColumn)[];
}

const schemaNames = new WeakMap<CoreSchema, SchemaNames>();

export interface QueryBinding {
  readonly table: string;
  readonly name: string;
  readonly reference: string;
  readonly alias?: string;
  readonly names?: SchemaNames;
  readonly ftsTable?: string | boolean | undefined;
}

export function bindTable(target: CoreSchema | TrustedTable, alias?: string): QueryBinding {
  if (target === null || typeof target !== 'object') {
    throw new TypeError('a query requires a declared schema or an explicit trustedTable target');
  }
  if (TRUSTED_TABLE in target) {
    const match = /^(\S+)\s+(?:as\s+)?(\S+)$/i.exec(target.table.trim());
    const name = match?.[1] ?? target.table.trim();
    const tableAlias = alias ?? match?.[2];
    return {
      table: tableAlias && (tableAlias !== name || match?.[2] !== undefined) ? `${name} AS ${tableAlias}` : name,
      name,
      reference: tableAlias ?? name,
      ...(tableAlias === undefined ? {} : { alias: tableAlias }),
      ftsTable: target.ftsTable,
    };
  }
  if (!('ir' in target)) throw new TypeError('a query requires a declared schema or an explicit trustedTable target');
  let names = schemaNames.get(target);
  if (names === undefined) {
    names = {
      columns: new Map(target.ir.columns.map(column => [column.name, column.physicalName])),
      projection: target.ir.columns.map(column =>
        column.name === column.physicalName ? column.name : { column: column.physicalName, alias: column.name },
      ),
    };
    schemaNames.set(target, names);
  }
  return {
    table: alias ? `${target.ir.physicalTable} AS ${alias}` : target.ir.physicalTable,
    name: target.ir.table,
    reference: alias ?? target.ir.physicalTable,
    ...(alias === undefined ? {} : { alias }),
    names,
    ftsTable: target.ftsTable,
  };
}

export function columnBinding(
  root: QueryBinding,
  joins: readonly QueryBinding[] | undefined,
  column: string,
): QueryBinding {
  const dot = column.lastIndexOf('.');
  if (dot < 0) return root;
  const name = column.slice(0, dot);
  if (name === (root.alias ?? root.name)) return root;
  const joined = joins?.find(binding => name === (binding.alias ?? binding.name));
  if (joined !== undefined) return joined;
  if (root.names === undefined) return root;
  throw new TypeError(`column ${JSON.stringify(column)} is outside the query schema scope`);
}

export function mapColumn(root: QueryBinding, column: string, joins?: readonly QueryBinding[]): string {
  if (column === '*' || column === '') return column;
  const binding = columnBinding(root, joins, column);
  if (binding.names === undefined) return column;
  const dot = column.lastIndexOf('.');
  const property = column.slice(dot + 1);
  const physical = property === '*' ? '*' : binding.names.columns.get(property);
  if (physical === undefined && root.names === undefined) return column;
  if (physical === undefined) throw new TypeError(`unknown schema property ${JSON.stringify(column)}`);
  return dot < 0 ? physical : `${binding.reference}.${physical}`;
}

export function mapProjection(
  root: QueryBinding,
  column: string | AliasedColumn,
  joins?: readonly QueryBinding[],
): string | AliasedColumn {
  if (typeof column !== 'string') return { column: mapColumn(root, column.column, joins), alias: column.alias };
  const physical = mapColumn(root, column, joins);
  return column !== '*' && !column.endsWith('.*') && (column.includes('.') || physical !== column)
    ? { column: physical, alias: column }
    : physical;
}

export function mapPredicates(
  root: QueryBinding,
  predicates: readonly Predicate[],
  joins?: readonly QueryBinding[],
): Predicate[] {
  return predicates.map(predicate =>
    predicate.kind === 'group'
      ? { ...predicate, predicates: mapPredicates(root, predicate.predicates, joins) }
      : { ...predicate, col: mapColumn(root, predicate.col, joins) },
  );
}

export function mapRow(binding: QueryBinding, row: Record<string, unknown>): Record<string, unknown> {
  if (binding.names === undefined) return row;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [mapColumn(binding, key), value]));
}
