import { createQueryCompiler } from '@zmdb/sql';

for (const dialect of ['postgres', 'mysql', 'sqlite', 'mssql', 'cockroach', 'singlestore']) {
  const query = createQueryCompiler(dialect)
    .selectFrom('users')
    .select(['id', 'email'])
    .where('id', '=', 7)
    .orderBy('id', 'asc')
    .limit(2)
    .compile();
  if (query.parameters.length !== 1 || query.parameters[0] !== 7 || !query.text.includes('users')) {
    throw new Error(`@zmdb/sql failed the ${dialect} installed compilation`);
  }
}
