import { jsonSchemaFromIR, schemaFromIR } from '@zmdb/schema/ir';

const ir = {
  table: 'users',
  physicalTable: 'app_users',
  columns: [
    {
      name: 'id',
      physicalName: 'user_id',
      sql: 'integer',
      nullable: false,
      primaryKey: true,
      serial: true,
      unique: true,
      hasDefault: true,
      sensitive: false,
      constraints: {},
      rules: [],
    },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
};

const schema = schemaFromIR(ir);
const document = jsonSchemaFromIR(ir);
if (schema.table !== 'app_users' || schema.primaryKey[0] !== 'user_id') {
  throw new Error('@zmdb/schema did not preserve physical schema names');
}
if (document.properties.id?.type !== 'integer') {
  throw new Error('@zmdb/schema did not derive JSON Schema from its IR');
}
