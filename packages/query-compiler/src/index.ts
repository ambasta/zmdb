// @zmdb/query-compiler — API stubs (red phase). Implementation in #17–#20.

const NOT_IMPL = 'not implemented';

export type Dialect = 'postgres' | 'mysql' | 'sqlite';
export type Operator = '=' | '!=' | '<' | '<=' | '>' | '>=' | 'like' | 'in';
export type Direction = 'asc' | 'desc';

export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
}

export interface SelectBuilder {
  select(columns?: readonly string[]): SelectBuilder;
  where(col: string, op: Operator, value: unknown): SelectBuilder;
  andWhere(col: string, op: Operator, value: unknown): SelectBuilder;
  orWhere(col: string, op: Operator, value: unknown): SelectBuilder;
  orderBy(col: string, dir: Direction): SelectBuilder;
  limit(n: number): SelectBuilder;
  offset(n: number): SelectBuilder;
  compile(): CompiledQuery;
}

export interface InsertBuilder {
  values(row: Record<string, unknown>): InsertBuilder;
  returning(cols?: readonly string[]): InsertBuilder;
  compile(): CompiledQuery;
}

export interface UpdateBuilder {
  set(row: Record<string, unknown>): UpdateBuilder;
  where(col: string, op: Operator, value: unknown): UpdateBuilder;
  returning(cols?: readonly string[]): UpdateBuilder;
  compile(): CompiledQuery;
}

export interface DeleteBuilder {
  where(col: string, op: Operator, value: unknown): DeleteBuilder;
  returning(cols?: readonly string[]): DeleteBuilder;
  compile(): CompiledQuery;
}

export interface QueryCompiler {
  selectFrom(table: string): SelectBuilder;
  insertInto(table: string): InsertBuilder;
  updateTable(table: string): UpdateBuilder;
  deleteFrom(table: string): DeleteBuilder;
}

export function createQueryCompiler(_dialect: Dialect = 'postgres'): QueryCompiler {
  throw new Error(NOT_IMPL);
}
