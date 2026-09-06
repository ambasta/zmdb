import type { ChangeOp, ColumnSnapshot, ExtensionType, SchemaSnapshot } from '@zmdb/migrations';
import { postgresFamilyMigrations } from '@zmdb/postgres';
import {
  UnsupportedFeatureError,
  type MigrationConnection,
  type MigrationDialect,
  type MigrationDriver,
  type MigrationPlan,
  type MigrationTableOptions,
  type SchemaObjectOperation,
} from '@zmdb/query-compiler';
import type { IndexColumn } from '@zmdb/query-compiler/schema-objects';

export const COCKROACH_TYPE_OVERRIDES = Object.freeze({
  serial: 'INT8 DEFAULT unique_rowid()',
  integer: 'INT4',
});

const parent = postgresFamilyMigrations('cockroach', {
  types: COCKROACH_TYPE_OVERRIDES,
});

function extensionName(type: ExtensionType): string {
  return `${type.extension}.${type.name}`;
}

function refuseExtension(feature: string): never {
  throw new UnsupportedFeatureError(
    feature,
    'cockroach',
    `cockroach does not expose PostgreSQL extension installation or extension-backed column types (${feature})`,
  );
}

function validateColumn(column: ColumnSnapshot): void {
  if (typeof column.type !== 'string') refuseExtension(`extension type ${extensionName(column.type)}`);
}

function validateSnapshot(snapshot: SchemaSnapshot): void {
  const extension = snapshot.extensions[0];
  if (extension !== undefined) refuseExtension(`extension "${extension.name}"`);
  for (const table of snapshot.tables) {
    for (const column of table.columns) validateColumn(column);
  }
}

function validateOperation(operation: ChangeOp): void {
  switch (operation.kind) {
    case 'create_extension':
      refuseExtension(`extension "${operation.name}"`);
    case 'create_table':
      for (const column of operation.columns) validateColumn(column);
      return;
    case 'add_column':
      validateColumn(operation.column);
      return;
    case 'alter_column_type':
      if (typeof operation.from !== 'string') refuseExtension(`extension type ${extensionName(operation.from)}`);
      if (typeof operation.to !== 'string') refuseExtension(`extension type ${extensionName(operation.to)}`);
      return;
    default:
      return;
  }
}

function opclass(column: IndexColumn): string | undefined {
  return typeof column === 'string' ? undefined : column.opclass;
}

function validateSchemaObject(operation: SchemaObjectOperation): void {
  switch (operation.kind) {
    case 'enable_rls':
    case 'create_policy':
      throw new UnsupportedFeatureError(
        'row-level security',
        'cockroach',
        'cockroach row-level-security support varies by server release; @zmdb/cockroach refuses PostgreSQL policy DDL',
      );
    case 'create_extension':
      refuseExtension(`extension "${operation.definition.name}"`);
    case 'create_index': {
      const method = operation.definition.method;
      if (method !== undefined) {
        throw new UnsupportedFeatureError(
          `index method ${method}`,
          'cockroach',
          `cockroach indexes are emitted without a PostgreSQL USING method ("${operation.definition.name}")`,
        );
      }
      const column = operation.definition.columns.find(value => opclass(value) !== undefined);
      const selectedOpclass = column === undefined ? undefined : opclass(column);
      if (selectedOpclass !== undefined) {
        throw new UnsupportedFeatureError(
          `index operator class ${selectedOpclass}`,
          'cockroach',
          `cockroach indexes do not accept PostgreSQL operator classes ("${operation.definition.name}")`,
        );
      }
      return;
    }
    default:
      return;
  }
}

export const cockroachMigrations: MigrationDialect<'cockroach'> = Object.freeze({
  name: 'cockroach',
  validateSnapshot(snapshot: SchemaSnapshot): void {
    parent.validateSnapshot(snapshot);
    validateSnapshot(snapshot);
  },
  validatePlan(plan: MigrationPlan): void {
    parent.validatePlan(plan);
    validateSnapshot(plan.before);
    validateSnapshot(plan.after);
    for (const operation of plan.operations) validateOperation(operation);
  },
  ddlType(column: ColumnSnapshot): string {
    validateColumn(column);
    return parent.ddlType(column);
  },
  emitUp(operation: ChangeOp): string {
    validateOperation(operation);
    return parent.emitUp(operation);
  },
  emitDown(operation: ChangeOp): string {
    validateOperation(operation);
    return parent.emitDown(operation);
  },
  emitSchemaObject(operation: SchemaObjectOperation): readonly string[] {
    validateSchemaObject(operation);
    return parent.emitSchemaObject(operation);
  },
  connection(driver: MigrationDriver<'cockroach'>, options?: MigrationTableOptions): MigrationConnection<'cockroach'> {
    const connection = parent.connection(driver, options);
    const { transaction: ignoredTransaction, ...nonTransactional } = connection;
    void ignoredTransaction;
    return Object.freeze({
      ...nonTransactional,
      transactionalDdl: false,
    });
  },
});
