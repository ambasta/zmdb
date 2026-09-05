import { BaseRepository, ValidationError } from '@zmdb/orm';
import { schemaFromIR } from '@zmdb/schema/ir';

const schema = schemaFromIR({
  table: 'users',
  physicalTable: 'users',
  columns: [
    {
      name: 'id',
      physicalName: 'id',
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
    {
      name: 'email',
      physicalName: 'email',
      sql: 'varchar',
      nullable: false,
      primaryKey: false,
      serial: false,
      unique: true,
      hasDefault: false,
      sensitive: false,
      constraints: { minLength: 3 },
      rules: [],
    },
  ],
  primaryKey: ['id'],
  relations: [],
  foreignKeys: [],
});

const queries = [];
const driver = {
  dialect: 'sqlite',
  async execute(query) {
    queries.push(query);
    if (query.text.startsWith('INSERT')) return [{ id: 1, email: query.parameters[0] }];
    return [{ id: 1, email: 'a@example.test' }];
  },
};

class Users extends BaseRepository {
  static schema = schema;
}

const users = new Users(driver, 'sqlite');
const created = await users.create({ email: 'a@example.test' });
const found = await users.findById(1);
if (created.id !== 1 || found?.email !== 'a@example.test' || queries.length !== 2) {
  throw new Error('@zmdb/orm did not execute installed typed CRUD through the structural driver');
}

try {
  await users.create({ email: 'x' });
  throw new Error('@zmdb/orm accepted an invalid payload');
} catch (error) {
  if (!(error instanceof ValidationError)) throw error;
}
