import type { CoreSchema, Entity } from '@zmdb/schema';
import { jsonSchemaFromIR, schemaFromIR, type JsonSchemaObject, type SchemaIR } from '@zmdb/schema/ir';
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
