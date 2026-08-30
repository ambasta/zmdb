// @zmdb/repository — implementation.
// #26 read methods (findById/findOne/findAll) implemented via injected driver
// + query-compiler. #27 (create/update) and #28 (delete/hooks) remain
// unimplemented; their tests stay red.
import type { CoreSchema, Entity, CreateDTO, UpdateDTO } from '@zmdb/schema-core';
import type { CompiledQuery, Dialect } from '@zmdb/query-compiler';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';
import { aggregateSelectFrom } from '@zmdb/query-compiler/aggregations';
import {
  compileWhere,
  applyOrderBy,
  applyPagination,
  buildListResult,
  type WhereDTO,
  type ListDTO,
  type ListResult,
} from '@zmdb/schema-core/dto';

export interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

// Shape of an entry in a repository's static `relations` map (see typed-populate SPEC).
interface RelationDefLike {
  readonly cardinality: 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many';
  readonly childTable: string;
  readonly childFk: string;
  readonly parentKey?: string;
}

export class ValidationError extends Error {
  readonly issues: readonly { path: string; message: string }[] = [];
}

export abstract class BaseRepository<S extends CoreSchema<string>> {
  static readonly schema: CoreSchema<string>;
  protected driver: Driver;
  protected readonly qb: ReturnType<typeof createQueryCompiler>;
  protected readonly dialect: Dialect;

  constructor(driver: Driver, dialect: Dialect = 'postgres') {
    this.driver = driver;
    this.dialect = dialect;
    this.qb = createQueryCompiler(dialect);
  }

  // #37 — bind this repository to a transaction context so all its SQL runs
  // on the transaction's connection. Returns a shallow, tx-scoped clone (no
  // shared mutable state with the original repository).
  withTransaction(tx: { execute: Driver['execute'] }): this {
    const scoped = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(scoped, this);
    scoped.driver = { execute: (q) => tx.execute(q) };
    return scoped;
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

  // #218 — typed populate. When `opts.populate` names relations (declared in the
  // subclass's static `relations` map), the parent is widened with the nested
  // relation(s). Batched IN query per relation; no proxies.
  async findById(id: unknown): Promise<Entity<S> | undefined>;
  async findById(id: unknown, opts: { populate: readonly string[] }): Promise<(Entity<S> & Record<string, unknown>) | undefined>;
  async findById(id: unknown, opts?: { populate?: readonly string[] }): Promise<Entity<S> | undefined> {
    const q = this.qb.selectFrom(this.tableName).where(this.pkColumn, '=', id).limit(1).compile();
    const rows = await this.driver.execute(q);
    const row = rows[0] as (Entity<S> & Record<string, unknown>) | undefined;
    if (!row || !opts?.populate?.length) return row;
    await this.attachRelations([row as Record<string, unknown>], opts.populate);
    return row;
  }

  /** Batch-load and attach the named relations onto the given parent rows. */
  private async attachRelations(parents: Record<string, unknown>[], names: readonly string[]): Promise<void> {
    if (parents.length === 0) return;
    const relations = (this.constructor as { relations?: Record<string, RelationDefLike> }).relations ?? {};
    for (const name of names) {
      const def = relations[name];
      if (!def) throw new Error(`unknown relation "${name}" on ${this.tableName}`);
      const parentKey = def.parentKey ?? 'id';
      const ids = parents.map((p) => p[parentKey]);
      // One batched query for all parents' children (OR chain = IN).
      let cb = this.qb.selectFrom(def.childTable);
      ids.forEach((id, i) => { cb = i === 0 ? cb.where(def.childFk, '=', id) : cb.orWhere(def.childFk, '=', id); });
      const children = await this.driver.execute(cb.compile());
      const toMany = def.cardinality === 'one-to-many' || def.cardinality === 'many-to-many';
      const byParent = new Map<unknown, Record<string, unknown>[]>();
      for (const c of children) {
        const list = byParent.get(c[def.childFk]) ?? [];
        list.push(c as Record<string, unknown>);
        byParent.set(c[def.childFk], list);
      }
      for (const p of parents) {
        const list = byParent.get(p[parentKey]) ?? [];
        p[name] = toMany ? list : (list[0] ?? null);
      }
    }
  }

  async findOne(where: WhereDTO<S>): Promise<Entity<S> | undefined> {
    const b = compileWhere(this.qb.selectFrom(this.tableName), where as WhereDTO<CoreSchema<string>>);
    const rows = await this.driver.execute(b.limit(1).compile());
    return rows[0] as Entity<S> | undefined;
  }

  async find(where: WhereDTO<S>): Promise<readonly Entity<S>[]> {
    const b = compileWhere(this.qb.selectFrom(this.tableName), where as WhereDTO<CoreSchema<string>>);
    return (await this.driver.execute(b.compile())) as readonly Entity<S>[];
  }

  async findAll(): Promise<readonly Entity<S>[]> {
    return (await this.driver.execute(this.qb.selectFrom(this.tableName).compile())) as readonly Entity<S>[];
  }

  async list(query?: ListDTO<S>): Promise<ListResult<Entity<S>>> {
    let b = this.qb.selectFrom(this.tableName);
    if (query?.where) b = compileWhere(b, query.where as WhereDTO<CoreSchema<string>>);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (query?.orderBy) b = applyOrderBy(b as any, query.orderBy as any) as typeof b;
    // Fetch limit+1 so buildListResult can compute hasMore by trimming.
    const limit = query?.page && 'limit' in query.page ? query.page.limit : undefined;
    if (query?.page) {
      const probe = { ...query.page, limit: limit !== undefined ? limit + 1 : undefined } as typeof query.page;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      b = applyPagination(b as any, probe as any) as typeof b;
    }
    const rows = await this.driver.execute(b.compile());
    const opts = limit !== undefined ? { limit } : {};
    return buildListResult(rows as Record<string, unknown>[], opts) as ListResult<Entity<S>>;
  }

  // #96 — full-text search integration. Uses the query-compiler FTS builder;
  // on dialects without arbitrary-column FTS (sqlite) this throws an honest
  // UnsupportedFeatureError (never a silently-wrong query).
  async findByFullText(column: string, term: string): Promise<readonly Record<string, unknown>[]> {
    const q = ftsSelectFrom(this.tableName, this.dialect).whereMatch(column, term).compile();
    return this.driver.execute(q);
  }

  // #87 — JOIN integration. Fetch this table left-joined to a target on an FK,
  // filtered by a predicate on the base table. Returns flat joined rows (plain
  // objects — no proxies). Uses the query-compiler JOIN builder.
  async findJoined(
    join: { target: string; leftCol: string; rightCol: string; kind?: 'inner' | 'left' },
    where?: { col: string; op: string; value: unknown },
  ): Promise<readonly Record<string, unknown>[]> {
    let b = joinableSelectFrom(this.tableName, this.dialect);
    b = (join.kind === 'inner' ? b.innerJoin : b.leftJoin).call(
      b,
      join.target,
      join.leftCol,
      join.rightCol,
    );
    if (where) b = b.where(where.col, where.op, where.value);
    return this.driver.execute(b.compile());
  }

  // #92 — aggregation integration. Runs a grouped aggregate (count/sum/…)
  // returning typed computed columns. `build` receives the aggregate builder so
  // callers compose exactly the aggregate they need.
  async aggregate<R extends Record<string, unknown>>(
    build: (agg: ReturnType<typeof aggregateSelectFrom>) => { compile(): { text: string; parameters: readonly unknown[] } },
  ): Promise<readonly R[]> {
    const q = build(aggregateSelectFrom(this.tableName, this.dialect)).compile();
    return this.driver.execute(q) as Promise<readonly R[]>;
  }

  // #34 — explicit populate for a to-many relation. Loads parents, then batches
  // one IN() query for children, and attaches them under `relationName`. No
  // proxies, no identity map — children are plain rows on plain parents.
  async findAllWithMany(
    relationName: string,
    childTable: string,
    childFk: string,
    parentKey = 'id',
  ): Promise<readonly Record<string, unknown>[]> {
    const parents = [...(await this.findAll())].map((p) => ({ ...p }));
    if (parents.length === 0) return parents;
    const ids = parents.map((p) => p[parentKey]);
    let cb = this.qb.selectFrom(childTable);
    // Build a single batched IN() via repeated OR on the FK (compiler-agnostic).
    ids.forEach((id, i) => {
      cb = i === 0 ? cb.where(childFk, '=', id) : cb.orWhere(childFk, '=', id);
    });
    const children = await this.driver.execute(cb.compile());
    const byParent = new Map<unknown, Record<string, unknown>[]>();
    for (const c of children) {
      const key = c[childFk];
      const list = byParent.get(key) ?? [];
      list.push({ ...c });
      byParent.set(key, list);
    }
    for (const p of parents) {
      (p as Record<string, unknown>)[relationName] = byParent.get(p[parentKey]) ?? [];
    }
    return parents;
  }

  // #207 — typed create/update. Signatures are the derived DTOs; runtime reuses
  // validatePayload (validate-before-SQL) unchanged.
  async create(dto: CreateDTO<S>): Promise<Entity<S>> {
    const clean = this.validatePayload(dto, 'create');
    this.preInsert(clean);
    const rows = await this.driver.execute(
      this.qb.insertInto(this.tableName).values(clean).returning(['*']).compile(),
    );
    const row = rows[0] ?? {};
    this.postInsert(row);
    return row as Entity<S>;
  }

  async update(id: unknown, patch: UpdateDTO<S>): Promise<Entity<S> | undefined> {
    const clean = this.validatePayload(patch, 'update');
    this.preUpdate(clean);
    const rows = await this.driver.execute(
      this.qb.updateTable(this.tableName).set(clean).where(this.pkColumn, '=', id).returning(['*']).compile(),
    );
    return rows[0] as Entity<S> | undefined;
  }

  // #28 — delete + lifecycle hooks.
  async delete(id: unknown): Promise<boolean> {
    this.preDelete(id);
    const rows = await this.driver.execute(
      this.qb.deleteFrom(this.tableName).where(this.pkColumn, '=', id).returning([this.pkColumn]).compile(),
    );
    return rows.length > 0;
  }

  // Explicit, synchronous lifecycle hooks. No hidden change tracking — these
  // fire only around the corresponding operation, in documented order.
  protected preInsert(_row: Record<string, unknown>): void {}
  protected postInsert(_row: Record<string, unknown>): void {}
  protected preUpdate(_row: Record<string, unknown>): void {}
  protected preDelete(_id: unknown): void {}
  protected postSelect(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
    return rows;
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
