import type { TransactionalDriver } from '@zmdb/orm';
import { createQueryCompiler, type CompiledQuery, type QueryCompiler, type SqlDialect } from '@zmdb/sql';

declare const dialect: SqlDialect<string>;
declare const driver: TransactionalDriver<string>;

const compiler: QueryCompiler = createQueryCompiler(dialect);
const insert: CompiledQuery = compiler.insertInto('publication_rows').values({ id: 7, visits: 1 }).compile();
const select: CompiledQuery = compiler.selectFrom('publication_rows').where('id', '=', 7).compile();
const update: CompiledQuery = compiler.updateTable('publication_rows').set({ visits: 2 }).where('id', '=', 7).compile();
const remove: CompiledQuery = compiler.deleteFrom('publication_rows').where('id', '=', 7).compile();
const signal: AbortSignal = new AbortController().signal;

void driver.execute(insert, { signal });
void driver.execute(select);
void driver.execute(update);
void driver.execute(remove);
const transaction: Promise<number> = driver.transaction(async current => {
  await current.execute(select);
  return 7;
});

// @ts-expect-error a driver requires a compiled query, not a raw SQL string
void driver.execute('SELECT 1');
// @ts-expect-error cancellation uses an AbortSignal
void driver.execute(select, { signal: 'cancel' });
// @ts-expect-error the compiler requires an explicit dialect object
void createQueryCompiler('postgres');

export { transaction };
