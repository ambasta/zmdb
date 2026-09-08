import { BaseRepository, type Driver } from '@zmdb/orm';
import { compileWhere } from '@zmdb/orm/dto';
import type { SubqueryTarget } from '@zmdb/schema/dto';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema/tags';
import { createQueryCompiler, type SqlDialect, type SelectBuilder } from '@zmdb/sql';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'>;
}

declare const driver: Driver;
declare const dialect: SqlDialect<'acme'>;

class Users extends BaseRepository<User> {}

const repository: BaseRepository<User> = new Users(driver, dialect);
const row: Promise<{ readonly id: number; readonly email: string } | undefined> = repository.findById(1);

void row;

const actualBuilder = createQueryCompiler(dialect).selectFrom('users').select(['id']);
const actualFolded: typeof actualBuilder = compileWhere<User, typeof actualBuilder>(actualBuilder, { id: { eq: 1 } });

declare const builder: SelectBuilder<number>;
const subquery: SubqueryTarget<number> = builder;
const folded: SelectBuilder<number> = compileWhere<User, typeof builder>(builder, { id: { eq: 1 } });
// @ts-expect-error Incompatible phantom result types are rejected.
const wrongSubquery: SubqueryTarget<string> = builder;
// @ts-expect-error Pure entity shape transforms have one schema owner.
export type { flattenEmbeddable } from '@zmdb/orm/entity-modeling';
void [actualFolded, subquery, folded, wrongSubquery];
