import { BaseRepository, type Driver } from '@zmdb/orm';
import { compileWhere } from '@zmdb/orm/dto';
import type { TaggedSchema } from '@zmdb/schema';
import type { SubqueryTarget } from '@zmdb/schema/dto';
import type { PrimaryKey, Serial, Sql, Table } from '@zmdb/schema/tags';
import { createQueryCompiler, type SqlDialect } from '@zmdb/sql';

interface User extends Table<'users'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  email: string & Sql<'varchar'>;
}

declare const driver: Driver;
declare const dialect: SqlDialect<'acme'>;
declare const schema: TaggedSchema<User>;

class Users extends BaseRepository<User> {}

const repository: BaseRepository<User> = new Users(driver, dialect);
const row: Promise<{ readonly id: number; readonly email: string } | undefined> = repository.findById(1);

void row;

const actualBuilder = createQueryCompiler(dialect).selectFrom(schema).select(['id']);
const actualFolded: typeof actualBuilder = compileWhere<User, typeof actualBuilder>(actualBuilder, { id: { eq: 1 } });

declare const builder: typeof actualBuilder;
const subquery: SubqueryTarget<{ readonly id: number }> = builder;
const folded: typeof builder = compileWhere<User, typeof builder>(builder, { id: { eq: 1 } });
// @ts-expect-error Incompatible projected column types are rejected.
const wrongSubquery: SubqueryTarget<{ readonly id: string }> = builder;
// @ts-expect-error Pure entity shape transforms have one schema owner.
export type { flattenEmbeddable } from '@zmdb/orm/entity-modeling';
void [actualFolded, subquery, folded, wrongSubquery];
