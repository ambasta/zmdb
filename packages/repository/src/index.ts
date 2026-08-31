import type { CompiledQuery, Dialect } from '@zmdb/query-compiler';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { aggregateSelectFrom, type AggregateSelect } from '@zmdb/query-compiler/aggregations';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';
// @zmdb/repository — the repository layer: reads (#26), writes (#27), delete +
// lifecycle hooks (#28), transactions (#37), typed populate (#217) and the
// no-subclass wiring helper (#223). Every SQL statement comes from
// @zmdb/query-compiler and every type from the schema; there is no runtime
// reflection, no proxies and no identity map.
import {
  isRecord,
  ValidationError,
  type ColumnMeta,
  type CoreSchema,
  type CreateDTO,
  type Entity,
  type PrimaryKey,
  type UpdateDTO,
  type ValidationIssue,
  type JoinRow,
} from '@zmdb/schema-core';
import {
  compileWhere,
  applyOrderBy,
  applyPagination,
  buildListResult,
  decodeCursor,
  applyKeysetFilter,
  type WhereDTO,
  type ListDTO,
  type ListResult,
  type OrderBySpec,
  type AggregateSpec,
} from '@zmdb/schema-core/dto';
import type { Cardinality, RelationMeta } from '@zmdb/schema-core/relations';

export interface Driver {
  readonly dialect?: Dialect;
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
  readonly target?: string | undefined;
  readonly fk?: string | undefined;
  readonly mappedBy?: string | undefined;
  readonly rel?:
    | {
        cardinality?: 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many' | undefined;
        target?: string | undefined;
        fk?: string | undefined;
        mappedBy?: string | undefined;
        parentKey?: string | undefined;
      }
    | undefined;
  readonly meta?:
    | RelationMeta
    | {
        cardinality?: Cardinality | 'one-to-many' | 'many-to-one' | 'one-to-one' | 'many-to-many' | undefined;
        target?: string | undefined;
        fk?: string | undefined;
        mappedBy?: string | undefined;
        parentKey?: string | undefined;
        through?: string | undefined;
        owning?: boolean | undefined;
      }
    | undefined;
  readonly entity?: CoreSchema<string> | unknown;
}

export interface RepositoryAggregateBuilder extends ReturnType<typeof aggregateSelectFrom> {
  joinRelation(relationName: string, kind?: 'inner' | 'left' | 'right'): RepositoryAggregateBuilder;
}

/** A repository's relations map: relation name → definition. */
export type RelationsLike = Readonly<Record<string, RelationDefLike>>;

/** A repository with no declared relations — the default for `BaseRepository`. */
export type NoRelations = Readonly<Record<never, never>>;

type RelationCardinality<D> = D extends { cardinality: infer C }
  ? C
  : D extends { rel: { cardinality: infer RC } }
    ? RC
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

export { ValidationError, type ValidationIssue };

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

  private buildKeyWhere(id: PrimaryKey<S>): WhereDTO<CoreSchema<string>> {
    const pkCols = this.schema.primaryKey;
    if (!pkCols || pkCols.length === 0) {
      throw new Error(`schema ${this.tableName} has no primary key`);
    }

    if (pkCols.length === 1) {
      const pkCol = pkCols[0]!;
      return { [pkCol]: id } as WhereDTO<CoreSchema<string>>;
    }

    if (id === null || typeof id !== 'object' || id instanceof Date) {
      throw new ValidationError(`composite primary key for schema ${this.tableName} requires an object map`);
    }

    const idObj = id as Record<string, unknown>;
    const where: Record<string, unknown> = {};
    for (const col of pkCols) {
      if (!(col in idObj) || idObj[col] === undefined) {
        throw new ValidationError(`missing composite primary key column "${col}" for schema ${this.tableName}`);
      }
      where[col] = idObj[col];
    }
    return where as WhereDTO<CoreSchema<string>>;
  }

  // #218 — typed populate. When `opts.populate` names relations (declared in the
  // subclass's static `relations` map and passed as `R`), the result is widened
  // with those relations *and only those*. Batched IN query per relation; no
  // proxies. Populate keys are `keyof R`, so a misspelled relation is a compile
  // error rather than the runtime `unknown relation` throw below.
  async findById(id: PrimaryKey<S>): Promise<Entity<S> | undefined>;
  async findById<K extends keyof R & string>(
    id: PrimaryKey<S>,
    opts: { populate: readonly K[] },
  ): Promise<Populated<S, R, K> | undefined>;
  async findById(id: PrimaryKey<S>, opts?: { populate?: readonly string[] }): Promise<Entity<S> | undefined> {
    const where = this.buildKeyWhere(id);
    const q = compileWhere(this.qb.selectFrom(this.tableName), where).limit(1).compile();
    const rows = await this.rows<EntityRow<S>>(q);
    const row = rows[0];
    if (!row || !opts?.populate?.length) return row;
    const [populated] = await this.attachRelations([row], opts.populate);
    return populated;
  }

  /** Batch-load and attach named relations to parent rows without mutating inputs. */
  private async attachRelations<T extends Record<string, unknown>>(
    parents: readonly T[],
    names: readonly string[],
  ): Promise<readonly T[]> {
    if (parents.length === 0) return parents;
    // boundary: static side of subclass holds relations definition map; constructor is typed Function.
    const relations = (this.constructor as { relations?: Record<string, RelationDefLike> }).relations ?? {};
    let current: Record<string, unknown>[] = parents.map(p => ({ ...p }));

    for (const name of names) {
      const def = relations[name];
      if (!def) throw new Error(`unknown relation "${name}" on ${this.tableName}`);
      const meta = def.rel ?? def.meta;
      const childTable = def.childTable ?? def.target ?? meta?.target;
      const childFk = def.childFk ?? def.fk ?? def.mappedBy ?? meta?.fk ?? meta?.mappedBy;
      const cardinality = def.cardinality ?? meta?.cardinality;
      if (!childTable || !childFk) throw new Error(`invalid relation definition "${name}" on ${this.tableName}`);
      const parentKey = def.parentKey ?? (meta && 'parentKey' in meta ? meta.parentKey : undefined) ?? 'id';

      const ids = current.map(p => p[parentKey]);
      // One batched query for all parents' children (OR chain = IN).
      let cb = this.qb.selectFrom(childTable);
      ids.forEach((id, i) => {
        cb = i === 0 ? cb.where(childFk, '=', id) : cb.orWhere(childFk, '=', id);
      });
      const children = await this.driver.execute(cb.compile());
      const toMany = cardinality === 'one-to-many' || cardinality === 'many-to-many';
      const byParent = new Map<unknown, Record<string, unknown>[]>();
      for (const c of children) {
        const key = c[childFk];
        const list = byParent.get(key) ?? [];
        // boundary: driver returns opaque record objects.
        list.push(c as Record<string, unknown>);
        byParent.set(key, list);
      }
      current = current.map(p => {
        const list = byParent.get(p[parentKey]) ?? [];
        return {
          ...p,
          [name]: toMany ? list : (list[0] ?? null),
        };
      });
    }

    // boundary: populated rows are constructed by copying parent records and attaching relation properties matching Populated<S, R, K>.
    return current as unknown as readonly T[];
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
    const [populated] = await this.attachRelations([row], opts.populate);
    return populated;
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
    return this.attachRelations(rows, opts.populate);
  }

  async findAll<K extends keyof R & string>(opts: { populate: readonly K[] }): Promise<readonly Populated<S, R, K>[]>;
  async findAll(): Promise<readonly Entity<S>[]>;
  async findAll(opts?: { populate?: readonly string[] }): Promise<readonly Entity<S>[]> {
    const rows = await this.rows<EntityRow<S>>(this.qb.selectFrom(this.tableName).compile());
    if (!opts?.populate?.length) return rows;
    return this.attachRelations(rows, opts.populate);
  }

  async list<K extends keyof R & string>(
    query: ListDTO<S> | undefined,
    opts: { populate: readonly K[] },
  ): Promise<ListResult<Populated<S, R, K>>>;
  async list(query?: ListDTO<S>): Promise<ListResult<Entity<S>>>;
  async list(query?: ListDTO<S>, opts?: { populate?: readonly string[] }): Promise<ListResult<Entity<S>>> {
    let b = this.qb.selectFrom(this.tableName);
    const pkColumn = this.pkColumn;

    const userOrderBy = query?.orderBy;
    const effectiveOrderBy: OrderBySpec = userOrderBy
      ? userOrderBy.some(item => String(item.column) === pkColumn)
        ? userOrderBy
        : [...userOrderBy, { column: pkColumn, dir: 'asc' }]
      : [{ column: pkColumn, dir: 'asc' }];

    b = applyOrderBy(b, effectiveOrderBy);

    const page = query?.page;
    const limit = page && 'limit' in page ? page.limit : undefined;

    if (page && 'after' in page && page.after !== undefined && page.after !== null) {
      let cursorValues: Record<string, unknown>;
      if (typeof page.after === 'string') {
        cursorValues = decodeCursor(page.after);
      } else if (typeof page.after === 'object' && !Array.isArray(page.after)) {
        // boundary: page.after is an untrusted client DTO parameter; runtime check above proves it is a non-null, non-array object.
        cursorValues = page.after as Record<string, unknown>;
      } else {
        throw new Error('Invalid cursor parameter: expected string or object');
      }

      b = applyKeysetFilter(b, cursorValues, effectiveOrderBy, query?.where);

      if (limit !== undefined) {
        b = b.limit(limit + 1);
      }
    } else {
      if (query?.where) {
        b = compileWhere(b, query.where);
      }
      if (page) {
        b = applyPagination(b, {
          limit: limit !== undefined ? limit + 1 : page.limit,
          offset: 'offset' in page ? page.offset : undefined,
        });
      }
    }

    const rows = await this.rows<EntityRow<S>>(b.compile());
    const listOpts = {
      ...(limit !== undefined ? { limit } : {}),
      ...(query?.select ? { select: query.select } : {}),
      orderBy: effectiveOrderBy,
      pkColumn,
    };
    const res = buildListResult(rows, listOpts);
    if (opts?.populate?.length) {
      const populatedItems = await this.attachRelations(res.items, opts.populate);
      return { ...res, items: populatedItems };
    }
    return res;
  }

  // #96 — full-text search integration. Uses the query-compiler FTS builder.
  // SQLite compiles FTS5 virtual table JOINs when ftsTable is declared on the
  // schema; querying plain SQLite columns without a declared virtual table
  // throws UnsupportedFeatureError (never a silently-wrong query).
  async findByFullText(column: string, term: string): Promise<readonly Record<string, unknown>[]> {
    const ftsTable = (this.constructor as typeof BaseRepository).schema?.ftsTable;
    const q = ftsSelectFrom(this.tableName, this.dialect, { ftsTable }).whereMatch(column, term).compile();
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

  /** Resolve relation definition into target table and left/right join columns. */
  protected resolveRelationJoin(relationName: string): {
    targetTable: string;
    leftCol: string;
    rightCol: string;
  } {
    const relations = (this.constructor as { relations?: Record<string, RelationDefLike> }).relations ?? {};
    const def = relations[relationName];
    if (!def) {
      throw new Error(`unknown relation "${relationName}" on ${this.tableName}`);
    }
    const meta = def.rel ?? def.meta;
    const cardinality = def.cardinality ?? meta?.cardinality ?? 'many-to-one';
    const rawTargetTable = def.childTable ?? def.target ?? meta?.target;
    if (!rawTargetTable) {
      throw new Error(`missing target table for relation "${relationName}" on ${this.tableName}`);
    }
    const parentKey = def.parentKey ?? (meta && 'parentKey' in meta ? meta.parentKey : undefined) ?? 'id';

    const tableAlias = relationName.trim();
    const targetTable =
      rawTargetTable.toLowerCase() === tableAlias.toLowerCase() ? rawTargetTable : `${rawTargetTable} as ${tableAlias}`;

    let leftCol: string;
    let rightCol: string;

    if (cardinality === 'many-to-one' || cardinality === 'one-to-one') {
      const fk = def.fk ?? def.childFk ?? meta?.fk ?? `${relationName}Id`;
      leftCol = `${this.tableName}.${fk}`;
      rightCol = `${tableAlias}.${parentKey}`;
    } else {
      const childFk = def.mappedBy ?? def.childFk ?? meta?.mappedBy ?? `${this.tableName.replace(/s$/, '')}Id`;
      leftCol = `${this.tableName}.${parentKey}`;
      rightCol = `${tableAlias}.${childFk}`;
    }

    return { targetTable, leftCol, rightCol };
  }

  private createRepositoryAggregateBuilder(): RepositoryAggregateBuilder {
    let builder = aggregateSelectFrom(this.tableName, this.dialect);
    const resolveRelationJoin = (relationName: string) => this.resolveRelationJoin(relationName);

    const wrap = (b: AggregateSelect): RepositoryAggregateBuilder => {
      builder = b;
      const target: RepositoryAggregateBuilder = Object.assign(builder, {
        joinRelation(relationName: string, kind: 'inner' | 'left' | 'right' = 'inner'): RepositoryAggregateBuilder {
          const { targetTable, leftCol, rightCol } = resolveRelationJoin(relationName);
          let nextB = builder;
          if (kind === 'left') nextB = builder.leftJoin(targetTable, leftCol, rightCol);
          else if (kind === 'right') nextB = builder.rightJoin(targetTable, leftCol, rightCol);
          else nextB = builder.innerJoin(targetTable, leftCol, rightCol);
          return wrap(nextB);
        },
      });

      return new Proxy<RepositoryAggregateBuilder>(target, {
        get(t, prop, receiver) {
          if (prop === 'joinRelation') {
            return t.joinRelation;
          }
          const val = Reflect.get(t, prop, receiver);
          if (typeof val === 'function') {
            return (...args: unknown[]) => {
              const res = val.apply(t, args);
              if (
                res &&
                typeof res === 'object' &&
                'compile' in res &&
                typeof res.compile === 'function' &&
                'select' in res &&
                typeof res.select === 'function'
              ) {
                return wrap(res);
              }
              return res;
            };
          }
          return val;
        },
      });
    };

    return wrap(builder);
  }

  // #92 & relation-aware aggregations. Runs a grouped aggregate (count/sum/…)
  // returning typed computed columns or relation-aware flat output fields.
  async aggregate<Out extends Record<string, unknown> = Record<string, unknown>>(
    specOrBuild: AggregateSpec<S, R> | ((agg: RepositoryAggregateBuilder) => { compile(): CompiledQuery } | void),
  ): Promise<readonly Out[]> {
    let q: CompiledQuery;

    if (typeof specOrBuild === 'function') {
      const builder = this.createRepositoryAggregateBuilder();
      const res = specOrBuild(builder);
      q =
        res && typeof res === 'object' && 'compile' in res && typeof res.compile === 'function'
          ? res.compile()
          : builder.compile();
    } else if (typeof specOrBuild === 'object' && specOrBuild !== null) {
      const spec = specOrBuild;
      let builder = aggregateSelectFrom(this.tableName, this.dialect);
      const joinedRelations = new Set<string>();

      const applyJoin = (relName: string, kind: 'inner' | 'left' | 'right' = 'inner') => {
        if (joinedRelations.has(relName)) return;
        joinedRelations.add(relName);
        const { targetTable, leftCol, rightCol } = this.resolveRelationJoin(relName);
        if (kind === 'left') builder = builder.leftJoin(targetTable, leftCol, rightCol);
        else if (kind === 'right') builder = builder.rightJoin(targetTable, leftCol, rightCol);
        else builder = builder.innerJoin(targetTable, leftCol, rightCol);
      };

      if (spec.joins) {
        for (const item of spec.joins) {
          if (typeof item === 'string') {
            applyJoin(item);
          } else if (item && typeof item === 'object') {
            applyJoin(item.relation, item.kind);
          }
        }
      }

      const relations = (this.constructor as { relations?: Record<string, RelationDefLike> }).relations ?? {};
      const candidateCols: string[] = [];
      if (spec.groupBy) candidateCols.push(...spec.groupBy.map(String));
      if (spec.computed) {
        for (const comp of Object.values(spec.computed)) {
          if (comp.column) candidateCols.push(String(comp.column));
        }
      }
      if (spec.where) {
        candidateCols.push(...Object.keys(spec.where));
      }

      for (const col of candidateCols) {
        if (col.includes('.')) {
          const parts = col.split('.');
          const relCandidate = parts[0];
          if (relCandidate && relCandidate in relations) {
            applyJoin(relCandidate);
          }
        }
      }

      if (spec.groupBy && spec.groupBy.length > 0) {
        builder = builder.select(spec.groupBy.map(String)).groupBy(...spec.groupBy.map(String));
      }

      if (spec.computed) {
        for (const [alias, comp] of Object.entries(spec.computed)) {
          if (comp.raw) {
            builder = builder.expr(comp.raw, alias);
          } else {
            const fnLower = comp.fn.toLowerCase();
            const col = comp.column ? String(comp.column) : '*';
            if (fnLower === 'count') builder = builder.count(col, alias);
            else if (fnLower === 'sum') builder = builder.sum(col, alias);
            else if (fnLower === 'avg') builder = builder.avg(col, alias);
            else if (fnLower === 'min') builder = builder.min(col, alias);
            else if (fnLower === 'max') builder = builder.max(col, alias);
          }
        }
      }

      if (spec.where) {
        for (const [col, val] of Object.entries(spec.where)) {
          if (val !== undefined && val !== null && typeof val === 'object' && !Array.isArray(val)) {
            for (const [op, opVal] of Object.entries(val)) {
              builder = builder.where(col, op === 'eq' ? '=' : op, opVal);
            }
          } else {
            builder = builder.where(col, '=', val);
          }
        }
      }

      if (spec.having) {
        builder = builder.having(String(spec.having.column), spec.having.op, spec.having.value);
      }

      if (spec.orderBy) {
        for (const item of spec.orderBy) {
          builder = builder.orderBy(String(item.column), item.dir ?? 'asc');
        }
      }

      if (spec.limit !== undefined) builder = builder.limit(spec.limit);
      if (spec.offset !== undefined) builder = builder.offset(spec.offset);

      q = builder.compile();
    } else {
      throw new Error('aggregate requires a builder callback or AggregateSpec object');
    }

    const rawRows = await this.driver.execute(q);

    const mappedRows = rawRows.map(row => {
      const out: Record<string, unknown> = { ...row };
      for (const [k, v] of Object.entries(row)) {
        if (k.includes('.')) {
          const flatKey = k.replace('.', '_');
          if (!(flatKey in out)) {
            out[flatKey] = v;
          }
        } else if (k.includes('_')) {
          const dotKey = k.replace('_', '.');
          if (!(dotKey in out)) {
            out[dotKey] = v;
          }
        }
      }
      return out;
    });

    return mappedRows as readonly Out[];
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
      if (fetched.length === 0) return fetched;
      const ids = fetched.map(p => p[parentKey]);
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
      return fetched.map(p => ({
        ...p,
        [relationName]: byParent.get(p[parentKey]) ?? [],
      }));
    }
    const fetched = await this.rows<EntityRow<S>>(this.qb.selectFrom(this.tableName).compile());
    if (fetched.length === 0) return fetched;
    return this.attachRelations(fetched, [relationName]);
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

  async update(id: PrimaryKey<S>, patch: UpdateDTO<S>): Promise<Entity<S> | undefined> {
    const clean = this.validatePayload(patch, 'update');
    this.preUpdate(clean);
    if (Object.keys(clean).length === 0) {
      return this.findById(id);
    }
    const where = this.buildKeyWhere(id);
    const rows = await this.rows<EntityRow<S>>(
      compileWhere(this.qb.updateTable(this.tableName).set(clean), where).returning(['*']).compile(),
    );
    return rows[0];
  }

  // #28 — delete + lifecycle hooks.
  async delete(id: PrimaryKey<S>): Promise<boolean> {
    this.preDelete(id);
    const where = this.buildKeyWhere(id);
    const rows = await this.driver.execute(
      compileWhere(this.qb.deleteFrom(this.tableName), where).returning(this.schema.primaryKey).compile(),
    );
    return rows.length > 0;
  }

  // Explicit, synchronous lifecycle hooks. No hidden change tracking — these
  // fire only around the corresponding operation, in documented order.
  protected preInsert(_row: Record<string, unknown>): void {}
  protected postInsert(_row: Record<string, unknown>): void {}
  protected preUpdate(_row: Record<string, unknown>): void {}
  protected preDelete(_id: PrimaryKey<S>): void {}
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
      throw new ValidationError('payload must be an object', [
        { path: 'input', message: 'expected object', expected: 'object', value: payload },
      ]);
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
          issues.push({
            path: `input.${name}`,
            message: `missing required field "${name}"`,
            expected: 'defined',
            value: undefined,
          });
        }
        continue;
      }
      if (!this.valueMatchesColumn(value, col)) {
        issues.push({
          path: `input.${name}`,
          message: `invalid value for "${name}"`,
          expected: col.type,
          value,
        });
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
        return typeof value === 'object';
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

export * from './transactions/index.ts';
