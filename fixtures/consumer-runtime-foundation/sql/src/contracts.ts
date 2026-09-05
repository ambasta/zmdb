import {
  createQueryCompiler,
  type CompiledQuery,
  type Dialect,
  type QueryCompiler,
  type SelectBuilder,
} from '@zmdb/sql';

const dialect: Dialect = 'postgres';
const compiler: QueryCompiler = createQueryCompiler(dialect);
const select: SelectBuilder<{ readonly id: number }> = compiler
  .selectFrom<{ readonly id: number }>('users')
  .select(['id']);
const query: CompiledQuery = select.where('id', '=', 1).compile();

void query;
