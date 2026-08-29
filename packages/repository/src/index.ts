// @zmdb/repository — implementation.
// #26 read methods (findById/findOne/findAll) implemented via injected driver
// + query-compiler. #27 (create/update) and #28 (delete/hooks) remain
// unimplemented; their tests stay red.
import type { CoreSchema } from '@zmdb/schema-core';
import type { CompiledQuery } from '@zmdb/query-compiler';
import { createQueryCompiler } from '@zmdb/query-compiler';

const NOT_IMPL = 'not implemented';

export interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export class ValidationError extends Error {
  readonly issues: readonly { path: string; message: string }[] = [];
}

export abstract class BaseRepository<S extends CoreSchema<string>> {
  static readonly schema: CoreSchema<string>;
  protected readonly driver: Driver;
  protected readonly qb = createQueryCompiler('postgres');

  constructor(driver: Driver) {
    this.driver = driver;
  }

  private get schema(): CoreSchema<string> {
    // Bound by the concrete subclass via `static readonly schema = ...`.
    return (this.constructor as typeof BaseRepository).schema;
  }

  private get tableName(): string {
    return this.schema.table;
  }

  private get pkColumn(): string {
    const pk = this.schema.primaryKey[0];
    if (!pk) throw new Error(`schema ${this.tableName} has no primary key`);
    return pk;
  }

  async findById(id: unknown): Promise<Record<string, unknown> | undefined> {
    const q = this.qb.selectFrom(this.tableName).where(this.pkColumn, '=', id).limit(1).compile();
    const rows = await this.driver.execute(q);
    return rows[0];
  }

  async findOne(where: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    let b = this.qb.selectFrom(this.tableName);
    for (const [col, value] of Object.entries(where)) b = b.where(col, '=', value);
    const rows = await this.driver.execute(b.limit(1).compile());
    return rows[0];
  }

  async findAll(): Promise<readonly Record<string, unknown>[]> {
    return this.driver.execute(this.qb.selectFrom(this.tableName).compile());
  }

  // #27 — not yet implemented.
  create(_payload: unknown): Promise<Record<string, unknown>> {
    throw new Error(NOT_IMPL);
  }
  update(_id: unknown, _payload: unknown): Promise<Record<string, unknown> | undefined> {
    throw new Error(NOT_IMPL);
  }
  // #28 — not yet implemented.
  delete(_id: unknown): Promise<boolean> {
    throw new Error(NOT_IMPL);
  }
}
