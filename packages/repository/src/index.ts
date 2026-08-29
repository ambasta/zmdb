// @zmdb/repository — implementation.
// #26 read methods (findById/findOne/findAll) implemented via injected driver
// + query-compiler. #27 (create/update) and #28 (delete/hooks) remain
// unimplemented; their tests stay red.
import type { CoreSchema } from '@zmdb/schema-core';
import type { CompiledQuery } from '@zmdb/query-compiler';
import { createQueryCompiler } from '@zmdb/query-compiler';

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

  // #27 — create/update with validation interception.
  async create(payload: unknown): Promise<Record<string, unknown>> {
    const dto = this.validatePayload(payload, 'create');
    const rows = await this.driver.execute(
      this.qb.insertInto(this.tableName).values(dto).returning(['*']).compile(),
    );
    return rows[0] ?? {};
  }

  async update(id: unknown, payload: unknown): Promise<Record<string, unknown> | undefined> {
    const dto = this.validatePayload(payload, 'update');
    const rows = await this.driver.execute(
      this.qb.updateTable(this.tableName).set(dto).where(this.pkColumn, '=', id).returning(['*']).compile(),
    );
    return rows[0];
  }

  // #28 — delete.
  async delete(id: unknown): Promise<boolean> {
    const rows = await this.driver.execute(
      this.qb.deleteFrom(this.tableName).where(this.pkColumn, '=', id).returning([this.pkColumn]).compile(),
    );
    return rows.length > 0;
  }

  // Runtime validation against the schema's column metadata. Mirrors the DTO
  // rules: create omits autoIncrement; both variants reject wrong-typed values,
  // out-of-enum values, and (for create) missing required fields.
  private validatePayload(payload: unknown, variant: 'create' | 'update'): Record<string, unknown> {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      const e = new ValidationError('payload must be an object');
      (e as { issues: unknown }).issues = [{ path: 'input', message: 'expected object' }];
      throw e;
    }
    const obj = payload as Record<string, unknown>;
    const issues: { path: string; message: string }[] = [];
    const out: Record<string, unknown> = {};

    for (const [name, col] of Object.entries(this.schema.columns)) {
      if (col.flags.autoIncrement) continue; // never accepted from payloads
      const present = name in obj;
      const value = obj[name];

      if (!present) {
        const optional = col.flags.hasDefault === true || col.flags.nullable === true;
        if (variant === 'create' && !optional) {
          issues.push({ path: `input.${name}`, message: `missing required field "${name}"` });
        }
        continue;
      }
      if (!this.valueMatchesColumn(value, col)) {
        issues.push({ path: `input.${name}`, message: `invalid value for "${name}"` });
        continue;
      }
      out[name] = value;
    }

    if (issues.length > 0) {
      const e = new ValidationError(`validation failed: ${issues.map((i) => i.path).join(', ')}`);
      (e as { issues: unknown }).issues = issues;
      throw e;
    }
    return out;
  }

  private valueMatchesColumn(value: unknown, col: { type: string; flags: { nullable: boolean; enum?: readonly string[] } }): boolean {
    if (value === null) return col.flags.nullable;
    switch (col.type) {
      case 'serial':
      case 'integer':
      case 'bigint':
      case 'numeric':
        return typeof value === 'number' || typeof value === 'bigint';
      case 'text':
      case 'varchar':
        return typeof value === 'string';
      case 'boolean':
        return typeof value === 'boolean';
      case 'timestamp':
        return value instanceof Date || typeof value === 'string';
      case 'jsonEnum':
        return typeof value === 'string' && (col.flags.enum?.includes(value) ?? false);
      case 'json':
      default:
        return true;
    }
  }
}
