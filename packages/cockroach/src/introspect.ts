import {
  CatalogRowError,
  integerField,
  query,
  textField,
  type CatalogColumnSnapshot,
  type CatalogIndexColumn,
  type CatalogIndexSnapshot,
  type CatalogSchemaSnapshot,
  type CatalogTableSnapshot,
  type IntrospectionDriver,
} from '@zmdb/migrations/introspect/runtime';
import { postgresFamilyIntrospector } from '@zmdb/postgres';
import type { IntrospectOptions } from '@zmdb/query-compiler';

interface CockroachIndexRow {
  readonly name: string;
  readonly nonUnique: boolean;
  readonly sequence: number;
  readonly column: string;
  readonly definition: string;
  readonly storing: boolean;
  readonly implicit: boolean;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function selectedSchemas(options: IntrospectOptions | undefined): readonly string[] {
  const schemas = options?.schemas ?? ['public'];
  return schemas.length === 0 ? ['public'] : [...new Set(schemas)].toSorted();
}

function placeholders(count: number): string {
  return Array.from({ length: count }, (_, index) => `$${String(index + 1)}`).join(', ');
}

function booleanField(row: Readonly<Record<string, unknown>>, field: string, catalog: string, index: number): boolean {
  const value = Reflect.get(row, field);
  if (typeof value === 'boolean') return value;
  if (value === 't' || value === 'true' || value === 1 || value === '1') return true;
  if (value === 'f' || value === 'false' || value === 0 || value === '0') return false;
  throw new CatalogRowError(catalog, index, field, 'a boolean', value);
}

function parseIndexRow(row: Readonly<Record<string, unknown>>, index: number): CockroachIndexRow {
  const catalog = 'cockroach SHOW INDEXES';
  return {
    name: textField(row, 'index_name', catalog, index),
    nonUnique: booleanField(row, 'non_unique', catalog, index),
    sequence: integerField(row, 'seq_in_index', catalog, index),
    column: textField(row, 'column_name', catalog, index),
    definition: textField(row, 'definition', catalog, index),
    storing: booleanField(row, 'storing', catalog, index),
    implicit: booleanField(row, 'implicit', catalog, index),
  };
}

function unquoteIdentifier(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value;
}

function balancedOuterParentheses(value: string): boolean {
  if (!value.startsWith('(') || !value.endsWith(')')) return false;
  let depth = 0;
  let quoteCharacter: "'" | '"' | undefined;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quoteCharacter !== undefined) {
      if (character === quoteCharacter) {
        if (value[index + 1] === quoteCharacter) index += 1;
        else quoteCharacter = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quoteCharacter = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth === 0 && index < value.length - 1) return false;
  }
  return depth === 0;
}

function stripOuterParentheses(value: string): string {
  let current = value.trim();
  while (balancedOuterParentheses(current)) current = current.slice(1, -1).trim();
  return current;
}

function indexColumn(row: CockroachIndexRow, tableColumns: ReadonlySet<string>): CatalogIndexColumn {
  if (!row.column.startsWith('crdb_internal_') && tableColumns.has(row.column)) return row.column;
  const definition = row.definition.trim();
  const identifier = /^("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)$/.exec(definition)?.[1];
  if (identifier !== undefined) {
    const column = unquoteIdentifier(identifier);
    if (tableColumns.has(column)) return column;
  }
  return { expr: stripOuterParentheses(definition) };
}

function identifierAt(value: string, start: number): { readonly name: string; readonly end: number } | undefined {
  if (value[start] === '"') {
    let index = start + 1;
    let name = '';
    while (index < value.length) {
      const character = value[index];
      if (character === '"') {
        if (value[index + 1] === '"') {
          name += '"';
          index += 2;
          continue;
        }
        return { name, end: index + 1 };
      }
      if (character === undefined) return undefined;
      name += character;
      index += 1;
    }
    return undefined;
  }
  const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(value.slice(start));
  const name = match?.[0];
  return name === undefined ? undefined : { name, end: start + name.length };
}

function matchingParenthesis(value: string, open: number): number | undefined {
  let depth = 0;
  let quoteCharacter: "'" | '"' | undefined;
  for (let index = open; index < value.length; index += 1) {
    const character = value[index];
    if (quoteCharacter !== undefined) {
      if (character === quoteCharacter) {
        if (value[index + 1] === quoteCharacter) index += 1;
        else quoteCharacter = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quoteCharacter = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function indexPredicates(createStatement: string): ReadonlyMap<string, string> {
  const predicates = new Map<string, string>();
  for (const rawLine of createStatement.split('\n')) {
    const line = rawLine.trim().replace(/,$/, '');
    const prefix = /^(?:UNIQUE\s+)?INDEX\s+/i.exec(line)?.[0];
    if (prefix === undefined) continue;
    const identifier = identifierAt(line, prefix.length);
    if (identifier === undefined) continue;
    const open = line.indexOf('(', identifier.end);
    if (open === -1) continue;
    const close = matchingParenthesis(line, open);
    if (close === undefined) continue;
    const suffix = line.slice(close + 1);
    const where = /\sWHERE\s+(.+)$/i.exec(suffix)?.[1]?.trim();
    if (where !== undefined && where.length > 0) predicates.set(identifier.name, where);
  }
  return predicates;
}

function indexes(
  rows: readonly CockroachIndexRow[],
  primaryIndexes: ReadonlySet<string>,
  tableColumns: ReadonlySet<string>,
  predicates: ReadonlyMap<string, string>,
): readonly CatalogIndexSnapshot[] {
  const grouped = new Map<string, CockroachIndexRow[]>();
  for (const row of rows) {
    if (primaryIndexes.has(row.name) || row.storing || row.implicit) continue;
    const values = grouped.get(row.name);
    if (values === undefined) grouped.set(row.name, [row]);
    else values.push(row);
  }
  return [...grouped]
    .map(([name, values]) => {
      const sorted = values.toSorted((left, right) => left.sequence - right.sequence);
      const first = sorted[0];
      if (first === undefined) throw new Error(`cockroach index "${name}" has no key columns`);
      const where = predicates.get(name);
      return {
        name,
        columns: sorted.map(row => indexColumn(row, tableColumns)),
        unique: !first.nonUnique,
        ...(where === undefined ? {} : { where }),
      };
    })
    .toSorted((left, right) => left.name.localeCompare(right.name));
}

async function schemasByTable(
  driver: IntrospectionDriver,
  options: IntrospectOptions | undefined,
): Promise<ReadonlyMap<string, string>> {
  const schemas = selectedSchemas(options);
  const rows = await driver.execute(
    query(
      `SELECT table_schema, table_name FROM information_schema.tables ` +
        `WHERE table_type = 'BASE TABLE' AND table_schema IN (${placeholders(schemas.length)}) ` +
        'ORDER BY table_schema, table_name',
      schemas,
    ),
  );
  return new Map(
    rows.map((row, index) => [
      textField(row, 'table_name', 'cockroach information_schema.tables', index),
      textField(row, 'table_schema', 'cockroach information_schema.tables', index),
    ]),
  );
}

function cockroachColumn(column: CatalogColumnSnapshot): CatalogColumnSnapshot {
  const defaultValue = column.default?.trim().toLowerCase();
  if (
    column.type !== 'bigint' ||
    defaultValue === undefined ||
    !/^unique_rowid\(\)(?:::[a-z0-9_ ]+)?$/.test(defaultValue)
  ) {
    return column;
  }
  const { default: ignoredDefault, ...withoutDefault } = column;
  void ignoredDefault;
  return { ...withoutDefault, type: 'serial' };
}

async function cockroachTable(
  driver: IntrospectionDriver,
  schema: string,
  table: CatalogTableSnapshot,
): Promise<CatalogTableSnapshot> {
  const qualified = `${quoteIdentifier(schema)}.${quoteIdentifier(table.name)}`;
  const [indexRows, constraintRows, createRows] = await Promise.all([
    driver.execute(query(`SHOW INDEXES FROM ${qualified}`)),
    driver.execute(query(`SHOW CONSTRAINTS FROM ${qualified}`)),
    driver.execute(query(`SHOW CREATE TABLE ${qualified}`)),
  ]);
  const primaryIndexes = new Set(
    constraintRows
      .filter((row, index) => textField(row, 'constraint_type', 'cockroach SHOW CONSTRAINTS', index) === 'PRIMARY KEY')
      .map((row, index) => textField(row, 'constraint_name', 'cockroach SHOW CONSTRAINTS', index)),
  );
  const createRow = createRows[0];
  if (createRow === undefined) throw new Error(`cockroach SHOW CREATE returned no row for ${qualified}`);
  const predicates = indexPredicates(textField(createRow, 'create_statement', 'cockroach SHOW CREATE TABLE', 0));
  const columns = table.columns.map(cockroachColumn);
  return {
    ...table,
    columns,
    indexes: indexes(
      indexRows.map(parseIndexRow),
      primaryIndexes,
      new Set(columns.map(column => column.name)),
      predicates,
    ),
  };
}

async function cockroachSnapshot(
  parent: (driver: IntrospectionDriver, options?: IntrospectOptions) => Promise<CatalogSchemaSnapshot>,
  driver: IntrospectionDriver,
  options?: IntrospectOptions,
): Promise<CatalogSchemaSnapshot> {
  const base = await parent(driver, options);
  const schemaByTable = await schemasByTable(driver, options);
  const tables: CatalogTableSnapshot[] = [];
  for (const table of base.tables) {
    const schema = schemaByTable.get(table.name);
    if (schema === undefined)
      throw new Error(`cockroach introspection could not resolve the schema for "${table.name}"`);
    tables.push(await cockroachTable(driver, schema, table));
  }
  return { ...base, tables };
}

export const cockroachIntrospector = postgresFamilyIntrospector('cockroach', {
  snapshot: cockroachSnapshot,
});
