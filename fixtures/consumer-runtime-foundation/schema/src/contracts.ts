import type { CoreSchema, Entity } from '@zmdb/schema';
// @ts-expect-error Runtime validation errors belong to validator.
export type { ValidationError } from '@zmdb/schema';
import type { SubqueryTarget } from '@zmdb/schema/dto';
// @ts-expect-error SQL folding belongs to ORM, never the semantic schema root.
export type { WhereTarget } from '@zmdb/schema/dto';
import { jsonSchemaFromIR, schemaFromIR, type JsonSchemaObject, type SchemaIR } from '@zmdb/schema/ir';
// @ts-expect-error Population execution belongs to ORM.
export type { PopulateQuery } from '@zmdb/schema/relations';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema/tags';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'>;
}

const ir: SchemaIR = {
  table: 'users',
  physicalTable: 'users',
  columns: [],
  primaryKey: [],
  relations: [],
  foreignKeys: [],
};
const schema: CoreSchema<string> = schemaFromIR(ir);
const document: JsonSchemaObject = jsonSchemaFromIR(ir);
const row: Entity<User> = { id: 1, email: 'a@example.test' };

void [schema, document, row];

const structural: SubqueryTarget<number> = {
  compile: () => ({
    effects: { operation: 'SELECT', requiresPrimary: false, returnsRows: true },
    text: 'SELECT 1',
    parameters: [1] as const,
    telemetry: { system: 'acme', operation: 'SELECT' as const, collection: 'users' },
  }),
  _type: 1,
};
const declared: SubqueryTarget<number> = { table: 'users', select: ['id'], _type: 1 };
// @ts-expect-error The compiled query must expose ordered parameters.
const missingParameters: SubqueryTarget<number> = { compile: () => ({ text: 'SELECT 1' }) };
// @ts-expect-error Phantom result inference must preserve the selected value type.
const wrongValue: SubqueryTarget<number> = { table: 'users', _type: '1' };
void [structural, declared, missingParameters, wrongValue];
