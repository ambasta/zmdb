import type { CompiledQuery, Dialect } from '@zmdb/query-compiler';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { aggregateSelectFrom } from '@zmdb/query-compiler/aggregations';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';
// @zmdb/repository — the repository layer: reads (#26), writes (#27), delete +
// lifecycle hooks (#28), transactions (#37), typed populate (#217) and the
// no-subclass wiring helper (#223). Every SQL statement comes from
// @zmdb/query-compiler and every type from the schema; there is no runtime
// reflection, no proxies and no identity map.
import { isRecord } from '@zmdb/schema-core';
import type { ColumnMeta, CoreSchema, Entity, CreateDTO, UpdateDTO, JoinRow } from '@zmdb/schema-core';
import {
  compileWhere,
  applyOrderBy,
  applyPagination,
  buildListResult,
  type WhereDTO,
  type ListDTO,
  type ListResult,
} from '@zmdb/schema-core/dto';
import type { Cardinality, RelationMeta } from '@zmdb/schema-core/relations';

export interface Driver {
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

/**
 * A fetched row: the derived entity plus the string-keyed view that populate
 * writes relations onto. The intersection (rather than `Entity<S>` alone) is what
 * makes keyed access legal without asserting.
 */
type EntityRow<S> = Entity<S> & Record<string, unknown>;

/**
 * One entry in a repository's `relations` map (see typed-populate/SPEC.md).
 *
 * `childTable`/`childFk`/`parentKey` drive the batched child query; `entity` is
 * the child *schema*, and exists purely so `Populated` can derive the attached
 * row type. `meta` is the `RelationMeta` from `@zmdb/schema-core/relations`,
 * carried for documentation/introspection — the runtime reads neither.
 */
export interface RelationDefLike {
  readonly cardinality?: Cardinality | 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many' | undefined;
  readonly childTable?: string | undefined;
  readonly childFk?: string | undefined;
  readonly parentKey?: string | undefined;
  readonly meta?:
    | {
        cardinality?: Cardinality | 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many' | undefined;
        target?: string | undefined;
        fk?: string | undefined;
        mappedBy?: string | undefined;
        through?: string | undefined;
        owning?: boolean | undefined;
      }
    | RelationMeta
    | undefined;
  readonly entity?: CoreSchema<string> | unknown;
}

/** A repository's relations map: relation name → definition. */
export type RelationsLike = Readonly<Record<string, RelationDefLike>>;

/** A repository with no declared relations — the default for `BaseRepository`. */
export type NoRelations = Readonly<Record<never, never>>;

type RelationCardinality<D> = D extends { cardinality: infer C }
  ? C
  : D extends { meta: { cardinality: infer MC } }
    ? MC
    : never;

type RelationEntity<D> = D extends { entity: infer E } ? (E extends CoreSchema<string> ? Entity<E> : E) : never;

// The value attached for one populated relation: an array of child entities for
// to-many, a single child (or null, when the FK matches nothing) for to-one.
type PopulatedField<D extends RelationDefLike> =
  RelationCardinality<D> extends 'one-to-many' | 'many-to-many'
    ? readonly RelationEntity<D>[]
    : RelationEntity<D> | null;

/**
 * `Entity<S>` widened with exactly the relations that were populated (#217).
 *
 * Only the requested keys `K` are added, which is what makes reading an
 * unpopulated relation a compile error instead of `undefined` at runtime — the
 * "no lazy getters" guarantee, stated as a type.
 */
export type Populated<S, R extends RelationsLike, K extends keyof R = keyof R> = Entity<S> & {
  readonly [P in K]: PopulatedField<R[P]>;
};

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  // Issues are constructor state, not a post-hoc field poke: assigning to a
  // `readonly` field from outside needed `(e as { issues: unknown }).issues = …`,
  // which also let an error escape with the field still empty.
  constructor(message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/**
 * The base repository.
 *
 * `S` is the schema (the source of every derived DTO); `R` is the relations map,
 * defaulting to "none". `R` is a *type* parameter rather than being read off the
 * static `relations` map because a class cannot refer to its own statics in its
 * own `extends` clause — declare the map as a const and pass `typeof` it:
 *
 * ```ts
 * const userRelations = { orders: { … } } as const;
 * class Users extends BaseRepository<typeof UserSchema, typeof userRelations> {
 *   static override readonly schema = UserSchema;
 *   static readonly relations = userRelations;
 * }
 * ```
 *
 * `defineRepository` infers both, so wiring a repository needs no subclass at all.
 */
export abstract class BaseRepository<S extends CoreSchema<string>, R extends RelationsLike = NoRelations> {
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
  // on the transaction's connection. Re-instantiates via standard constructor
  // invocation to allocate private instance state and avoid method binding leaks.
  withTransaction(tx: { execute: Driver['execute'] }): this {
    const txDriver: Driver = { execute: q => tx.execute(q) };
    const ctor = this.constructor as new (driver: Driver, dialect?: Dialect) => this;
    return new ctor(txDriver, this.dialect);
  }

  private get schema(): CoreSchema<string> {
    // boundary: `this.constructor` is typed `Function`; there is no way to say
    // "the static side of my own class". The subclass contract is
    // `static readonly schema = …`, declared abstractly above.
    return (this.constructor as typeof BaseRepository).schema;
  }

  private get tableName(): string {
    return this.schema.table;
  }

  /**
   * The one row-shape trust boundary in this package (ARCHITECTURE §2.1).
   *
   * A driver hands back untyped `Record<string, unknown>` rows; the compiled
   * query decides their shape, so exactly one assertion re-types them for the
   * caller. Every read method funnels through here instead of asserting at its
   * own return statement (which is how this file accumulated eight of them).
   */
  private async rows<Row>(query: CompiledQuery): Promise<readonly Row[]> {
    // boundary: driver rows are structurally opaque; the query that produced
    // them is what proves `Row`.
    return (await this.driver.execute(query)) as readonly Row[];
  }

  private get pkColumn(): string {
    const pk = this.schema.primaryKey[0];
    if (!pk) throw new Error(`schema ${this.tableName} has no primary key`);
    return pk;
  }

  // #218 — typed populate. When `opts.populate` names relations (declared in the
  // subclass's static `relations` map and passed as `R`), the result is widened
  // with those relations *and only those*. Batched IN query per relation; no
  // proxies. Populate keys are `keyof R`, so a misspelled relation is a compile
  // error rather than the runtime `unknown relation` throw below.
  async findById(id: unknown): Promise<Entity<S> | undefined>;
  async findById<K extends keyof R & string>(
    id: unknown,
    opts: { populate: readonly K[] },
  ): Promise<Populated<S, R, K> | undefined>;
  async findById(id: unknown, opts?: { populate?: readonly string[] }): Promise<Entity<S> | undefined> {
    const q = this.qb.selectFrom(this.tableName).where(this.pkColumn, '=', id).limit(1).compile();
    const rows = await this.rows<EntityRow<S>>(q);
    const row = rows[0];
    if (!row || !opts?.populate?.length) return row;
    await this.attachRelations([row], opts.populate);
    return row;
  }

  /** Batch-load and attach the named relations onto the given parent rows. */
  private async attachRelations(parents: Record<string, unknown>[], names: readonly string[]): Promise<void> {
    if (parents.length === 0) return;
    // boundary: same static-side limitation as `schema` above; `relations` is the
    // optional half of the subclass contract.
    const relations = (this.constructor as { relations?: Record<string, RelationDefLike> }).relations ?? {};
    for (const name of names) {
      const def = relations[name];
      if (!def) throw new Error(`unknown relation "${name}" on ${this.tableName}`);
      const childTable = def.childTable ?? (def.meta as { target?: string } | undefined)?.target;
      const childFk =
        def.childFk ??
        (def.meta as { mappedBy?: string; fk?: string } | undefined)?.mappedBy ??
        (def.meta as { mappedBy?: string; fk?: string } | undefined)?.fk;
      const cardinality = def.cardinality ?? (def.meta as { cardinality?: Cardinality } | undefined)?.cardinality;
      if (!childTable || !childFk) throw new Error(`invalid relation definition "${name}" on ${this.tableName}`);
      const parentKey = def.parentKey ?? 'id';
      const ids = parents.map(p => p[parentKey]);
      // One batched query for all parents' children (OR chain = IN).
      let cb = this.qb.selectFrom(childTable);
      ids.forEach((id, i) => {
        cb = i === 0 ? cb.where(childFk, '=', id) : cb.orWhere(childFk, '=', id);
      });
      const children = await this.driver.execute(cb.compile());
      const toMany = cardinality === 'one-to-many' || cardinality === 'many-to-many';
      const byParent = new Map<unknown, Record<string, unknown>[]>();
      for (const c of children) {
        const list = byParent.get(c[childFk]) ?? [];
        list.push(c as Record<string, unknown>);
        byParent.set(c[childFk], list);
      }
      for (const p of parents) {
        const list = byParent.get(p[parentKey]) ?? [];
        p[name] = toMany ? list : (list[0] ?? null);
      }
    }
  }

  async findOne<K extends keyof R & string>(
    where: WhereDTO<S>,
    opts: { populate: readonly K[] },
  ): Promise<Populated<S, R, K> | undefined>;
  async findOne(where: WhereDTO<S>): Promise<Entity<S> | undefined>;
  async findOne(where: WhereDTO<S>, opts?: { populate?: readonly string[] }): Promise<Entity<S> | undefined> {
    const b = compileWhere(this.qb.selectFrom(this.tableName), where);
    const rows = await this.rows<EntityRow<S>>(b.limit(1).compile());
    const row = rows[0];
    if (!row || !opts?.populate?.length) return row;
    await this.attachRelations([row], opts.populate);
    return row;
  }

  async find(where: WhereDTO<S>): Promise<readonly Entity<S>[]>;
  async find<K extends keyof R & string>(
    where: WhereDTO<S>,
    opts: { populate: readonly K[] },
  ): Promise<readonly Populated<S, R, K>[]>;
  async find(where: WhereDTO<S>, opts?: { populate?: readonly string[] }): Promise<readonly Entity<S>[]> {
    const b = compileWhere(this.qb.selectFrom(this.tableName), where);
    const rows = await this.rows<EntityRow<S>>(b.compile());
    if (!opts?.populate?.length) return rows;
    // `attachRelations` writes onto the parents, so copy them first: driver rows
    // are the caller's data in the no-populate path and must not grow keys here.
    const parents = rows.map(r => ({ ...r }));
    await this.attachRelations(parents, opts.populate);
    return parents;
  }

  async findAll<K extends keyof R & string>(opts: { populate: readonly K[] }): Promise<readonly Populated<S, R, K>[]>;
  async findAll(): Promise<readonly Entity<S>[]>;
  async findAll(opts?: { populate?: readonly string[] }): Promise<readonly Entity<S>[]> {
    const rows = await this.rows<EntityRow<S>>(this.qb.selectFrom(this.tableName).compile());
    if (!opts?.populate?.length) return rows;
    const parents = rows.map(r => ({ ...r }));
    await this.attachRelations(parents, opts.populate);
    return parents;
  }

  async list<K extends keyof R & string>(
    query: ListDTO<S> | undefined,
    opts: { populate: readonly K[] },
  ): Promise<ListResult<Populated<S, R, K>>>;
  async list(query?: ListDTO<S>): Promise<ListResult<Entity<S>>>;
  async list(query?: ListDTO<S>, opts?: { populate?: readonly string[] }): Promise<ListResult<Entity<S>>> {
    let b = this.qb.selectFrom(this.tableName);
    if (query?.where) b = compileWhere(b, query.where);
    if (query?.orderBy) b = applyOrderBy(b, query.orderBy);
    // Fetch limit+1 so buildListResult can compute hasMore by trimming.
    const page = query?.page;
    const limit = page?.limit;
    if (page) {
      b = applyPagination(b, { limit: page.limit + 1, offset: 'offset' in page ? page.offset : undefined });
    }
    const rows = await this.rows<EntityRow<S>>(b.compile());
    const opts2 = limit !== undefined ? { limit } : {};
    const res = buildListResult(rows, opts2);
    if (opts?.populate?.length) {
      await this.attachRelations(res.items as Record<string, unknown>[], opts.populate);
    }
    return res as ListResult<Entity<S>>;
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
  async findJoined<TargetS extends CoreSchema<string>, Kind extends 'inner' | 'left' = 'left'>(
    join: { target: TargetS; leftCol: string; rightCol: string; kind?: Kind },
    where?: { col: string; op: string; value: unknown },
  ): Promise<readonly JoinRow<Entity<S>, Entity<TargetS>, Kind>[]>;
  async findJoined<Joined = Record<string, unknown>, Kind extends 'inner' | 'left' = 'left'>(
    join: { target: string; leftCol: string; rightCol: string; kind?: Kind },
    where?: { col: string; op: string; value: unknown },
  ): Promise<readonly JoinRow<Entity<S>, Joined, Kind>[]>;
  async findJoined(
    join: { target: string | CoreSchema<string>; leftCol: string; rightCol: string; kind?: 'inner' | 'left' },
    where?: { col: string; op: string; value: unknown },
  ): Promise<readonly Record<string, unknown>[]> {
    const targetTable = typeof join.target === 'string' ? join.target : join.target.table;
    let b = joinableSelectFrom(this.tableName, this.dialect);
    b = (join.kind === 'inner' ? b.innerJoin : b.leftJoin).call(b, targetTable, join.leftCol, join.rightCol);
    if (where) b = b.where(where.col, where.op, where.value);
    return this.driver.execute(b.compile());
  }

  // #92 — aggregation integration. Runs a grouped aggregate (count/sum/…)
  // returning typed computed columns. `build` receives the aggregate builder so
  // callers compose exactly the aggregate they need.
  async aggregate<Row extends Record<string, unknown>>(
    build: (agg: ReturnType<typeof aggregateSelectFrom>) => {
      compile(): { text: string; parameters: readonly unknown[] };
    },
  ): Promise<readonly Row[]> {
    const q = build(aggregateSelectFrom(this.tableName, this.dialect)).compile();
    return this.rows<Row>(q);
  }

  // #34 — explicit populate for a to-many relation. Loads parents, then batches
  // one IN() query for children, and attaches them under `relationName`. No
  // proxies, no identity map — children are plain rows on plain parents.
  async findAllWithMany<K extends keyof R & string>(relationName: K): Promise<readonly Populated<S, R, K>[]>;
  async findAllWithMany(
    relationName: string,
    childTable: string,
    childFk: string,
    parentKey?: string,
  ): Promise<readonly Record<string, unknown>[]>;
  async findAllWithMany(
    relationName: string,
    childTable?: string,
    childFk?: string,
    parentKey = 'id',
  ): Promise<readonly Record<string, unknown>[]> {
    if (childTable && childFk) {
      const fetched = await this.rows<EntityRow<S>>(this.qb.selectFrom(this.tableName).compile());
      const parents: Record<string, unknown>[] = fetched.map(p => ({ ...p }));
      if (parents.length === 0) return parents;
      const ids = parents.map(p => p[parentKey]);
      let cb = this.qb.selectFrom(childTable);
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
        p[relationName] = byParent.get(p[parentKey]) ?? [];
      }
      return parents;
    }
    const fetched = await this.rows<EntityRow<S>>(this.qb.selectFrom(this.tableName).compile());
    const parents: Record<string, unknown>[] = fetched.map(p => ({ ...p }));
    if (parents.length === 0) return parents;
    await this.attachRelations(parents, [relationName]);
    return parents;
  }

  // #207 — typed create/update. Signatures are the derived DTOs; runtime reuses
  // validatePayload (validate-before-SQL) unchanged.
  async create(dto: CreateDTO<S>): Promise<Entity<S>> {
    const clean = this.validatePayload(dto, 'create');
    this.preInsert(clean);
    const rows = await this.rows<EntityRow<S>>(
      this.qb.insertInto(this.tableName).values(clean).returning(['*']).compile(),
    );
    const row = rows[0];
    if (!row) throw new Error(`insert into ${this.tableName} returned no row`);
    this.postInsert(row);
    return row;
  }

  async update(id: unknown, patch: UpdateDTO<S>): Promise<Entity<S> | undefined> {
    const clean = this.validatePayload(patch, 'update');
    this.preUpdate(clean);
    if (Object.keys(clean).length === 0) {
      return this.findById(id);
    }
    const rows = await this.rows<EntityRow<S>>(
      this.qb.updateTable(this.tableName).set(clean).where(this.pkColumn, '=', id).returning(['*']).compile(),
    );
    return rows[0];
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

  private sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const clean: Record<string, unknown> = {};
    for (const key of Object.keys(payload)) {
      if (payload[key] !== undefined) {
        clean[key] = payload[key];
      }
    }
    return clean;
  }

  // Runtime validation against the schema's column metadata. Mirrors the DTO
  // rules: create omits autoIncrement; both variants reject wrong-typed values,
  // out-of-enum values, and (for create) missing required fields.
  private validatePayload(payload: unknown, variant: 'create' | 'update'): Record<string, unknown> {
    if (!isRecord(payload)) {
      throw new ValidationError('payload must be an object', [{ path: 'input', message: 'expected object' }]);
    }
    const obj = this.sanitizePayload(payload);
    const issues: ValidationIssue[] = [];
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
      throw new ValidationError(`validation failed: ${issues.map(i => i.path).join(', ')}`, issues);
    }
    return out;
  }

  private valueMatchesColumn(value: unknown, col: ColumnMeta): boolean {
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

// #223 — wiring helper. Bind a schema (+ optional relations) to a driver and get
// a fully typed repository instance without writing a subclass.
export interface DefineRepositoryOptions<R extends RelationsLike = NoRelations> {
  dialect?: Dialect;
  relations?: R;
}
// `R` is inferred from `opts.relations`, so the returned repository's populate
// keys and populated row types come from the literal map the caller wrote — the
// subclass form has to spell `typeof userRelations` out by hand.
export function defineRepository<S extends CoreSchema<string>, R extends RelationsLike = NoRelations>(
  schema: S,
  driver: Driver,
  opts?: DefineRepositoryOptions<R>,
): BaseRepository<S, R> {
  // Anonymous subclass binding the schema (+ optional relations) as statics,
  // exactly like a hand-written subclass — no proxies, no magic.
  class Repo extends BaseRepository<S, R> {
    static override readonly schema = schema;
    static readonly relations = opts?.relations ?? {};
  }
  return new Repo(driver, opts?.dialect ?? 'postgres');
}
