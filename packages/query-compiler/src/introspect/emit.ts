import type { FormatConfig } from 'oxfmt';

import type { Dialect } from '../index.js';
import type { ColumnSnapshot, SchemaSnapshot, TableSnapshot } from '../migrations/index.js';
import { singularPascalCase } from '../naming/index.js';
import { sortWarnings, type CatalogWarning, type ReferentialAction } from './common.js';
import { escapeTypeString, renderTaggedProperty, typescriptPropertyName } from './tagged-property.js';

export interface EmitOptions {
  /** Required because a schema snapshot is deliberately dialect-neutral. */
  readonly dialect: Dialect;
}

export interface EmittedDeclarationFile {
  readonly path: string;
  readonly source: string;
}

export interface EmitDeclarationsResult {
  readonly files: readonly EmittedDeclarationFile[];
  readonly warnings: readonly CatalogWarning[];
}

interface ForeignKeyEvidence {
  readonly name: string;
  readonly columns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

type IndexColumnEvidence = string | { readonly column: string } | { readonly expr: string };

interface IndexEvidence {
  readonly name: string;
  readonly columns: readonly IndexColumnEvidence[];
  readonly unique: boolean;
  readonly where?: string;
}

interface TablePlan {
  readonly table: TableSnapshot;
  readonly interfaceName: string;
  readonly fileStem: string;
  readonly primaryKey: readonly string[];
  readonly foreignKeys: readonly ForeignKeyEvidence[];
  readonly indexes: readonly IndexEvidence[];
}

interface PropertyPlan {
  readonly column: ColumnSnapshot;
  readonly source?: string;
  readonly defaultExpression?: string;
}

interface RelationPlan {
  readonly name: string;
  readonly source: string;
  readonly target: TablePlan;
  readonly tag: 'ManyToOne' | 'OneToOne';
}

interface TableEmissionPlan {
  readonly table: TablePlan;
  readonly properties: readonly PropertyPlan[];
  readonly relations: readonly RelationPlan[];
  readonly tags: ReadonlySet<string>;
}

const FORMAT_OPTIONS: FormatConfig = {
  arrowParens: 'avoid',
  bracketSpacing: true,
  endOfLine: 'lf',
  insertFinalNewline: true,
  objectWrap: 'preserve',
  printWidth: 120,
  quoteProps: 'as-needed',
  semi: true,
  singleQuote: true,
  sortImports: true,
  tabWidth: 2,
  trailingComma: 'all',
  useTabs: false,
};

const RESERVED_INTERFACE_NAMES = new Set([
  'Date',
  'Ext',
  'HasDefault',
  'Length',
  'ManyToOne',
  'Max',
  'MaxLength',
  'Min',
  'MinLength',
  'OneToOne',
  'Pattern',
  'PrimaryKey',
  'References',
  'Rule',
  'Sensitive',
  'Serial',
  'Sql',
  'Table',
  'Unique',
]);

class WarningCollector {
  readonly #warnings = new Map<string, CatalogWarning>();

  constructor(initial: readonly CatalogWarning[]) {
    for (const warning of initial) this.add(warning);
  }

  add(warning: CatalogWarning): void {
    const key = `${warning.table}\0${warning.column ?? ''}\0${warning.reason}`;
    this.#warnings.set(key, warning);
  }

  values(): readonly CatalogWarning[] {
    return sortWarnings([...this.#warnings.values()]);
  }
}

/**
 * Turn a deterministic schema snapshot into formatter-clean tagged declarations.
 *
 * Catalog-only evidence is read structurally so an ordinary `SchemaSnapshot` remains a
 * valid input. That keeps the forward migration snapshot dialect-neutral while allowing
 * the richer introspection snapshot to contribute defaults, keys, indexes and warnings.
 */
export async function emitDeclarations(
  snapshot: SchemaSnapshot,
  options: EmitOptions,
): Promise<EmitDeclarationsResult> {
  const warnings = new WarningCollector(snapshotWarnings(snapshot));
  const tables = tablePlans(snapshot.tables, warnings);
  const byName = new Map(tables.map(table => [table.table.name, table]));
  const emissions = tables.map(table => analyzeTable(table, byName, warnings));
  const finalWarnings = warnings.values();

  const rawFiles = [
    ...emissions.map(emission => ({
      path: `${emission.table.fileStem}.ts`,
      source: renderTableFile(emission, finalWarnings, options.dialect, snapshot.version),
    })),
    {
      path: 'index.ts',
      source: renderIndexFile(tables, finalWarnings, options.dialect, snapshot.version),
    },
  ];
  const files = await Promise.all(
    rawFiles.map(async file => ({ path: file.path, source: await formatSource(file.path, file.source) })),
  );
  return { files, warnings: finalWarnings };
}

function tablePlans(tables: readonly TableSnapshot[], warnings: WarningCollector): readonly TablePlan[] {
  const sorted = tables.toSorted((left, right) => left.name.localeCompare(right.name));
  const duplicate = sorted.find(
    (table, index) => sorted.findIndex(candidate => candidate.name === table.name) !== index,
  );
  if (duplicate !== undefined) {
    throw new TypeError(`cannot emit two declarations for physical table "${duplicate.name}"`);
  }

  const usedNames = new Set<string>();
  const usedFiles = new Set<string>(['index']);
  return sorted.map(table => {
    const interfaceName = uniqueInterfaceName(table.name, usedNames, warnings);
    const fileStem = uniqueFileStem(table.name, usedFiles, warnings);
    return {
      table,
      interfaceName,
      fileStem,
      primaryKey: tablePrimaryKey(table),
      foreignKeys: tableForeignKeys(table),
      indexes: tableIndexes(table),
    };
  });
}

function uniqueInterfaceName(table: string, used: Set<string>, warnings: WarningCollector): string {
  const proposed = singularPascalCase(table);
  let base = proposed;
  if (!/^[$A-Z_a-z][$\w]*$/.test(proposed) || RESERVED_INTERFACE_NAMES.has(proposed)) {
    base = `Table${encodedName(table)}`;
    warnings.add({
      table,
      reason: `Physical table name "${table}" did not produce a safe TypeScript interface name; emitted ${base}`,
    });
  }

  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${String(suffix)}`;
    suffix += 1;
  }
  if (candidate !== base) {
    warnings.add({
      table,
      reason: `Interface name ${base} collides with another table; emitted ${candidate}`,
    });
  }
  used.add(candidate);
  return candidate;
}

function uniqueFileStem(table: string, used: Set<string>, warnings: WarningCollector): string {
  const safe = /^[A-Za-z0-9._-]+$/.test(table) && table !== '.' && table !== '..';
  const base = safe ? table : `table-${encodedName(table).toLowerCase()}`;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${base}-${String(suffix)}`;
    suffix += 1;
  }
  if (!safe || candidate !== base) {
    warnings.add({
      table,
      reason: `Physical table name "${table}" is not a unique safe file name; emitted ${candidate}.ts`,
    });
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function encodedName(value: string): string {
  const encoded = Array.from(value, character => character.codePointAt(0)?.toString(16) ?? '0').join('_');
  return encoded || 'Empty';
}

function analyzeTable(
  table: TablePlan,
  tables: ReadonlyMap<string, TablePlan>,
  warnings: WarningCollector,
): TableEmissionPlan {
  recordIndexWarnings(table, warnings);
  recordReferentialActionWarnings(table, warnings);

  const references = referenceTargets(table, warnings);
  const tags = new Set<string>(['Table']);
  const properties = table.table.columns
    .toSorted((left, right) => left.name.localeCompare(right.name))
    .map((column): PropertyPlan => {
      if (column.type === 'json') {
        warnings.add({
          table: table.table.name,
          column: column.name,
          reason: `Catalog type ${catalogType(column)} has no payload shape; emitted object`,
        });
      }

      const defaultExpression = columnDefault(column);
      const length = column.length;
      const enumValues = columnEnumValues(column);
      const reference = references.get(column.name);
      const rendered = renderTaggedProperty(column.name, {
        sql: column.type,
        nullable: column.nullable,
        primaryKey: column.primaryKey || table.primaryKey.includes(column.name),
        unique: columnIsUnique(table, column.name),
        hasDefault: defaultExpression !== undefined,
        ...(length === undefined ? {} : { length }),
        ...(enumValues === undefined ? {} : { enumValues }),
        ...(reference === undefined ? {} : { references: reference }),
      });
      if ('reason' in rendered) {
        warnings.add({
          table: table.table.name,
          column: column.name,
          reason: unrepresentableReason(column, rendered.reason),
        });
        return {
          column,
          ...(defaultExpression === undefined ? {} : { defaultExpression }),
        };
      }
      for (const tag of rendered.tags) tags.add(tag);
      return {
        column,
        source: rendered.source,
        ...(defaultExpression === undefined ? {} : { defaultExpression }),
      };
    });

  const relations = relationPlans(table, tables, warnings);
  for (const relation of relations) tags.add(relation.tag);
  return { table, properties, relations, tags };
}

function referenceTargets(table: TablePlan, warnings: WarningCollector): ReadonlyMap<string, string> {
  const byColumn = new Map<string, { readonly foreignKey: ForeignKeyEvidence; readonly position: number }[]>();
  for (const foreignKey of table.foreignKeys) {
    if (foreignKey.columns.length !== foreignKey.targetColumns.length) {
      warnings.add({
        table: table.table.name,
        reason:
          `Foreign key "${foreignKey.name}" has ${String(foreignKey.columns.length)} local columns and ` +
          `${String(foreignKey.targetColumns.length)} target columns; References tags were omitted`,
      });
      continue;
    }
    foreignKey.columns.forEach((column, position) => {
      const matches = byColumn.get(column);
      const evidence = { foreignKey, position };
      if (matches) matches.push(evidence);
      else byColumn.set(column, [evidence]);
    });
  }

  const result = new Map<string, string>();
  for (const [column, matches] of byColumn) {
    if (matches.length !== 1) {
      warnings.add({
        table: table.table.name,
        column,
        reason: `Column participates in ${String(matches.length)} foreign keys; its References tag is ambiguous and was omitted`,
      });
      continue;
    }
    const match = matches[0];
    if (match === undefined) continue;
    const targetColumn = match.foreignKey.targetColumns[match.position];
    if (targetColumn === undefined) continue;
    result.set(column, `${match.foreignKey.targetTable}.${targetColumn}`);
  }
  return result;
}

function relationPlans(
  table: TablePlan,
  tables: ReadonlyMap<string, TablePlan>,
  warnings: WarningCollector,
): readonly RelationPlan[] {
  const byTarget = new Map<string, ForeignKeyEvidence[]>();
  for (const foreignKey of table.foreignKeys) {
    const values = byTarget.get(foreignKey.targetTable);
    if (values) values.push(foreignKey);
    else byTarget.set(foreignKey.targetTable, [foreignKey]);
  }

  const candidates: RelationPlan[] = [];
  for (const [targetTable, foreignKeys] of [...byTarget].toSorted(([left], [right]) => left.localeCompare(right))) {
    if (foreignKeys.length > 1) {
      warnings.add({
        table: table.table.name,
        reason:
          `Foreign keys ${foreignKeys.map(key => `"${key.name}"`).join(', ')} all target "${targetTable}"; ` +
          'the relation property is ambiguous and was omitted',
      });
      continue;
    }
    const foreignKey = foreignKeys[0];
    if (foreignKey === undefined) continue;
    if (foreignKey.columns.length !== 1 || foreignKey.targetColumns.length !== 1) {
      warnings.add({
        table: table.table.name,
        reason: `Composite foreign key "${foreignKey.name}" cannot be represented by one relation property and was omitted`,
      });
      continue;
    }
    const localColumn = foreignKey.columns[0];
    if (localColumn === undefined) continue;
    const target = tables.get(targetTable);
    if (target === undefined) {
      warnings.add({
        table: table.table.name,
        column: localColumn,
        reason: `Foreign key "${foreignKey.name}" targets table "${targetTable}", which is absent from the snapshot`,
      });
      continue;
    }
    const name = lowerFirst(target.interfaceName);
    if (table.table.columns.some(column => column.name === name)) {
      warnings.add({
        table: table.table.name,
        column: localColumn,
        reason: `Relation name "${name}" collides with a physical column and was omitted`,
      });
      continue;
    }
    const tag = foreignKeyIsUnique(table, foreignKey) ? 'OneToOne' : 'ManyToOne';
    candidates.push({
      name,
      target,
      tag,
      source:
        `  ${typescriptPropertyName(name)}?: ${target.interfaceName} & ` +
        `${tag}<'${escapeTypeString(targetTable)}', '${escapeTypeString(localColumn)}'>;`,
    });
  }

  const nameCounts = new Map<string, number>();
  for (const candidate of candidates) nameCounts.set(candidate.name, (nameCounts.get(candidate.name) ?? 0) + 1);
  return candidates.filter(candidate => {
    if (nameCounts.get(candidate.name) === 1) return true;
    warnings.add({
      table: table.table.name,
      reason: `More than one foreign key produced relation name "${candidate.name}"; those relations were omitted`,
    });
    return false;
  });
}

function foreignKeyIsUnique(table: TablePlan, foreignKey: ForeignKeyEvidence): boolean {
  if (sameColumns(table.primaryKey, foreignKey.columns)) return true;
  return table.indexes.some(
    index =>
      index.unique &&
      index.where === undefined &&
      index.columns.every(column => typeof column === 'string') &&
      sameColumns(
        index.columns.filter(column => typeof column === 'string'),
        foreignKey.columns,
      ),
  );
}

function sameColumns(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every(column => right.includes(column));
}

function columnIsUnique(table: TablePlan, column: string): boolean {
  return table.indexes.some(
    index => index.unique && index.where === undefined && index.columns.length === 1 && index.columns[0] === column,
  );
}

function recordIndexWarnings(table: TablePlan, warnings: WarningCollector): void {
  for (const index of table.indexes) {
    if (
      index.unique &&
      index.where === undefined &&
      index.columns.length === 1 &&
      typeof index.columns[0] === 'string'
    ) {
      continue;
    }
    warnings.add({
      table: table.table.name,
      reason: `Index "${index.name}" is not representable by a single-column Unique tag and was not emitted`,
    });
  }
}

function recordReferentialActionWarnings(table: TablePlan, warnings: WarningCollector): void {
  for (const foreignKey of table.foreignKeys) {
    const onDelete = foreignKey.onDelete ?? 'no action';
    const onUpdate = foreignKey.onUpdate ?? 'no action';
    if (onDelete === 'no action' && onUpdate === 'no action') continue;
    warnings.add({
      table: table.table.name,
      reason:
        `Foreign key "${foreignKey.name}" has ON DELETE ${onDelete.toUpperCase()} and ` +
        `ON UPDATE ${onUpdate.toUpperCase()}, which current declaration tags cannot retain`,
    });
  }
}

function renderTableFile(
  emission: TableEmissionPlan,
  warnings: readonly CatalogWarning[],
  dialect: Dialect,
  version: SchemaSnapshot['version'],
): string {
  const table = emission.table;
  const tableWarnings = warnings.filter(warning => warning.table === table.table.name);
  const tableLevel = tableWarnings.filter(warning => warning.column === undefined);
  const knownColumns = new Set(emission.properties.map(property => property.column.name));
  const orphaned = tableWarnings.filter(warning => warning.column !== undefined && !knownColumns.has(warning.column));
  const importedTargets = emission.relations
    .map(relation => relation.target)
    .filter(target => target.table.name !== table.table.name)
    .filter(
      (target, index, values) =>
        values.findIndex(candidate => candidate.interfaceName === target.interfaceName) === index,
    )
    .toSorted((left, right) => left.interfaceName.localeCompare(right.interfaceName));

  const lines = header(dialect, version);
  lines.push(`import type { ${[...emission.tags].toSorted().join(', ')} } from '@zmdb/schema-core/tags';`);
  for (const target of importedTargets) {
    lines.push(`import type { ${target.interfaceName} } from './${escapeTypeString(target.fileStem)}.js';`);
  }
  lines.push('');
  for (const warning of tableLevel) lines.push(todoComment(warning));
  lines.push(`export interface ${table.interfaceName} extends Table<'${escapeTypeString(table.table.name)}'> {`);
  for (const property of emission.properties) {
    for (const warning of tableWarnings.filter(candidate => candidate.column === property.column.name)) {
      lines.push(todoComment(warning, '  '));
    }
    if (property.defaultExpression !== undefined) {
      lines.push(`  // Database default expression: ${JSON.stringify(property.defaultExpression)}`);
    }
    if (property.source !== undefined) lines.push(property.source);
  }
  for (const relation of emission.relations.toSorted((left, right) => left.name.localeCompare(right.name))) {
    lines.push(relation.source);
  }
  for (const warning of orphaned) lines.push(todoComment(warning, '  '));
  lines.push('}', '');
  return lines.join('\n');
}

function renderIndexFile(
  tables: readonly TablePlan[],
  warnings: readonly CatalogWarning[],
  dialect: Dialect,
  version: SchemaSnapshot['version'],
): string {
  const lines = header(dialect, version);
  const globalWarnings = warnings.filter(
    warning => warning.table === '*' || !tables.some(table => table.table.name === warning.table),
  );
  for (const warning of globalWarnings) lines.push(todoComment(warning));
  if (globalWarnings.length > 0) lines.push('');
  for (const table of tables) {
    lines.push(`export type { ${table.interfaceName} } from './${escapeTypeString(table.fileStem)}.js';`);
  }
  lines.push('');
  return lines.join('\n');
}

function header(dialect: Dialect, version: SchemaSnapshot['version']): string[] {
  return [
    `// Generated by zmdb introspection from a ${dialect} database. Do not edit; regenerate instead.`,
    `// Snapshot version ${String(version)}. Hand edits are overwritten wholesale.`,
    '',
  ];
}

function todoComment(warning: CatalogWarning, indent = ''): string {
  const subject = warning.column === undefined ? '' : `${warning.column}: `;
  return `${indent}// TODO: ${oneLine(`${subject}${warning.reason}`)}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function unrepresentableReason(column: ColumnSnapshot, detail: string): string {
  const type = catalogType(column);
  if (column.type === 'jsonEnum') {
    return `Catalog type ${type} cannot be represented without its enum members; column omitted (${detail})`;
  }
  return `Catalog type ${type} cannot be represented without data loss; column omitted (${detail})`;
}

function catalogType(column: ColumnSnapshot): string {
  const type = optionalString(column, 'catalogType') ?? snapshotTypeName(column.type);
  return type || '(untyped column)';
}

function snapshotTypeName(type: ColumnSnapshot['type']): string {
  if (typeof type === 'string') return type;
  const args = type.args ?? [];
  return args.length === 0 ? type.name : `${type.name}(${args.map(String).join(',')})`;
}

function columnDefault(column: ColumnSnapshot): string | undefined {
  return optionalString(column, 'default');
}

function columnEnumValues(column: ColumnSnapshot): readonly string[] | undefined {
  const value = Reflect.get(column, 'enumValues');
  return stringArray(value) ? value : undefined;
}

function tablePrimaryKey(table: TableSnapshot): readonly string[] {
  const value = Reflect.get(table, 'primaryKey');
  if (stringArray(value)) return value;
  return table.columns.filter(column => column.primaryKey).map(column => column.name);
}

function tableForeignKeys(table: TableSnapshot): readonly ForeignKeyEvidence[] {
  const value = Reflect.get(table, 'foreignKeys');
  if (!Array.isArray(value)) return [];
  const result: ForeignKeyEvidence[] = [];
  for (const candidate of value) {
    if (!record(candidate)) continue;
    const name = optionalString(candidate, 'name');
    const columns = Reflect.get(candidate, 'columns');
    const targetTable = optionalString(candidate, 'targetTable');
    const targetColumns = Reflect.get(candidate, 'targetColumns');
    if (name === undefined || !stringArray(columns) || targetTable === undefined || !stringArray(targetColumns)) {
      continue;
    }
    const onDelete = referentialAction(Reflect.get(candidate, 'onDelete'));
    const onUpdate = referentialAction(Reflect.get(candidate, 'onUpdate'));
    result.push({
      name,
      columns,
      targetTable,
      targetColumns,
      ...(onDelete === undefined ? {} : { onDelete }),
      ...(onUpdate === undefined ? {} : { onUpdate }),
    });
  }
  return result.toSorted((left, right) => left.name.localeCompare(right.name));
}

function tableIndexes(table: TableSnapshot): readonly IndexEvidence[] {
  const value = Reflect.get(table, 'indexes');
  if (!Array.isArray(value)) return [];
  const result: IndexEvidence[] = [];
  for (const candidate of value) {
    if (!record(candidate)) continue;
    const name = optionalString(candidate, 'name');
    const columns = indexColumns(Reflect.get(candidate, 'columns'));
    const unique = optionalBoolean(candidate, 'unique');
    if (name === undefined || columns === undefined || unique === undefined) continue;
    const where = optionalString(candidate, 'where');
    result.push({
      name,
      columns,
      unique,
      ...(where === undefined ? {} : { where }),
    });
  }
  return result.toSorted((left, right) => left.name.localeCompare(right.name));
}

function indexColumns(value: unknown): readonly IndexColumnEvidence[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: IndexColumnEvidence[] = [];
  for (const candidate of value) {
    if (typeof candidate === 'string') {
      result.push(candidate);
      continue;
    }
    if (!record(candidate)) return undefined;
    const column = optionalString(candidate, 'column');
    const expression = optionalString(candidate, 'expr');
    if (column !== undefined) {
      if (expression !== undefined) return undefined;
      result.push({ column });
      continue;
    }
    if (expression === undefined) return undefined;
    result.push({ expr: expression });
  }
  return result;
}

function snapshotWarnings(snapshot: SchemaSnapshot): readonly CatalogWarning[] {
  const value = Reflect.get(snapshot, 'warnings');
  if (!Array.isArray(value)) return [];
  const result: CatalogWarning[] = [];
  for (const candidate of value) {
    if (!record(candidate)) continue;
    const table = optionalString(candidate, 'table');
    const column = optionalString(candidate, 'column');
    const reason = optionalString(candidate, 'reason');
    if (table === undefined || reason === undefined) continue;
    result.push({ table, ...(column === undefined ? {} : { column }), reason });
  }
  return result;
}

function referentialAction(value: unknown): ReferentialAction | undefined {
  switch (value) {
    case 'no action':
    case 'restrict':
    case 'cascade':
    case 'set null':
    case 'set default':
      return value;
    default:
      return undefined;
  }
}

function optionalString(value: object, key: string): string | undefined {
  const candidate = Reflect.get(value, key);
  return typeof candidate === 'string' ? candidate : undefined;
}

function optionalBoolean(value: object, key: string): boolean | undefined {
  const candidate = Reflect.get(value, key);
  return typeof candidate === 'boolean' ? candidate : undefined;
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function record(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function lowerFirst(value: string): string {
  const first = value[0];
  return first === undefined ? value : `${first.toLowerCase()}${value.slice(1)}`;
}

async function formatSource(path: string, source: string): Promise<string> {
  const { format } = await import('oxfmt');
  const result = await format(path, source, FORMAT_OPTIONS);
  if (result.errors.length > 0) {
    throw new TypeError(`oxfmt could not format generated ${path}: ${JSON.stringify(result.errors)}`);
  }
  return result.code;
}
