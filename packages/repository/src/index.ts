// @zmdb/repository — API stubs (red phase). Implementation in #26–#29.
// Also declares the transactions surface (#35), spec in ./transactions.
import type { CoreSchema } from '@zmdb/schema-core';
import type { CompiledQuery } from '@zmdb/query-compiler';

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

  constructor(driver: Driver) {
    this.driver = driver;
    throw new Error(NOT_IMPL);
  }

  findById(_id: unknown): Promise<Record<string, unknown> | undefined> {
    throw new Error(NOT_IMPL);
  }
  findOne(_where: Record<string, unknown>): Promise<Record<string, unknown> | undefined> {
    throw new Error(NOT_IMPL);
  }
  findAll(): Promise<readonly Record<string, unknown>[]> {
    throw new Error(NOT_IMPL);
  }
  create(_payload: unknown): Promise<Record<string, unknown>> {
    throw new Error(NOT_IMPL);
  }
  update(_id: unknown, _payload: unknown): Promise<Record<string, unknown> | undefined> {
    throw new Error(NOT_IMPL);
  }
  delete(_id: unknown): Promise<boolean> {
    throw new Error(NOT_IMPL);
  }
}
