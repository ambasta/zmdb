// @zmdb/repository — the repository layer: reads (#26), writes (#27), delete +
// lifecycle hooks (#28), transactions (#37), typed populate (#217) and the
// no-subclass wiring helper (#223). Every SQL statement comes from
// @zmdb/query-compiler and every type from the schema; there is no runtime
// reflection, no proxies and no identity map.
import { issuesFor } from '@zmdb/aot-validator/utilities';
import type { CompiledQuery, Dialect } from '@zmdb/query-compiler';
import { createQueryCompiler, DIALECT_PARAM_LIMITS, sanitizeKeys, chunkArray } from '@zmdb/query-compiler';
import { aggregateSelectFrom, type AggregateSelect } from '@zmdb/query-compiler/aggregations';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';
import {
  isRecord,
  resolveRelation,
  ValidationError,
  type CoreSchema,
  type CreateDTO,
  type DeclaredTable,
  type Entity,
  type PrimaryKeyOf,
  type TaggedSchema,
  type UpdateDTO,
  type ValidationIssue,
  type JoinRow,
  type ResolvedRelation,
} from '@zmdb/schema-core';
import type { Populated, RelationKeys } from '@zmdb/schema-core/derive';
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
import {
  dbDecodedColumns,
  decodeDbValue,
  objectTypeFromShape,
  shapeOfVariant,
  type ColumnIR,
  type ObjectIR,
  type ShapeIR,
} from '@zmdb/schema-core/ir';

export interface Driver {
  readonly dialect?: Dialect;
  /** Enables compile-time query attributes when an execution wrapper consumes them. */
  readonly queryTelemetry?: true;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

/**
 * A fetched row: the derived entity plus the string-keyed view that populate
 * writes relations onto. The intersection (rather than `Entity<T>` alone) is what
 * makes keyed access legal without asserting.
 */
type EntityRow<T extends DeclaredTable> = Entity<T> & Record<string, unknown>;

export interface RepositoryAggregateBuilder extends ReturnType<typeof aggregateSelectFrom> {
  joinRelation(relationName: string, kind?: 'inner' | 'left' | 'right'): RepositoryAggregateBuilder;
}

export { ValidationError, type ValidationIssue };

export interface UpsertOptions {
  readonly target?: string | readonly string[] | undefined;
  readonly updateFields?: readonly string[] | Record<string, unknown> | undefined;
}

/**
 * Whether a value can be a single-column primary key.
 *
 * The composite branch of `buildKeyWhere` has always refused a key that is missing a
 * column; the single-column branch accepted anything and wrapped it, so an object
 * arriving from untyped input became `{ id: { … } }` — a where-spec that compiles to
 * no predicate at all and therefore an `UPDATE` or `DELETE` over the whole table
 * (#608). `PrimaryKeyOf<T>` rules this out at compile time for typed callers; this is
 * for the value that did not come through the types.
 *
 * `Date` counts as a scalar: it is one column's value for a `timestamp` key, and the
 * composite branch excludes it by name for the same reason.
 */
function isScalarKey(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean' ||
    value instanceof Date
  );
}

/** What a rejected key was, for the error message. Never the value itself. */
function describeKey(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return typeof value === 'function' ? 'a function' : `a ${typeof value}`;
}

/** Everything a write variant's validation needs, derived once. See `payloadShape`. */
interface PayloadShape {
  readonly shape: ShapeIR;
  readonly type: ObjectIR;
  /** The column names this variant accepts, for the excess check. */
  readonly accepted: ReadonlySet<string>;
}

/**
 * The base repository.
 *
 * `T` is the **declared type** — the interface the table was written as — and every DTO on
 * this class derives from it. It is not the schema value: a repository is handed one of
 * those at construction, and `defineRepository` recovers `T` from its phantom, but nothing
 * here reads a column map to work out what a row looks like.
 *
 * Relations come from `T` as well. There used to be a second type parameter for them,
 * paired with a static `relations` map, because `Entity<T>` was derived from a schema value
 * and a schema value carries no relations — so the map was the only place the runtime could
 * learn that `orders` means `orders.userId`. The declaration says it:
 *
 * ```ts
 * interface User extends Table<'users'> {
 *   id: number & Sql<'integer'> & Serial & PrimaryKey;
 *   orders?: Order[] & OneToMany<'orders', 'userId'>;
 * }
 *
 * class Users extends BaseRepository<User> {
 *   static override readonly schema = UserSchema;
 * }
 * ```
 *
 * `populate: ['orders']` is checked against `RelationKeys<User>` and the batched select it
 * runs comes from the same tag. `defineRepository` needs no subclass at all.
 */
export abstract class BaseRepository<T extends DeclaredTable> {
  static readonly schema: CoreSchema<string>;
  protected driver: Driver;
  protected readonly qb: ReturnType<typeof createQueryCompiler>;
  protected readonly dialect: Dialect;
  /** variant → its columns and their object type. See `payloadShape`. */
  readonly #shapes = new Map<'create' | 'update', PayloadShape>();
  /** The columns a driver may hand back in their storage form. See `decodeRows`. */
  #decoded: readonly ColumnIR[] | undefined;

  constructor(driver: Driver, dialect: Dialect = 'postgres') {
    this.driver = driver;
    this.dialect = dialect;
    this.qb = createQueryCompiler(dialect, driver.queryTelemetry === true ? { telemetry: true } : undefined);
  }

  // #37 — bind this repository to a transaction context so all its SQL runs
  // on the transaction's connection. Re-instantiates via standard constructor
  // invocation to allocate private instance state and avoid method binding leaks.
  //
  // boundary: the assertion names the constructor this class declares, on the subclass that
  // inherited it, and `this` as its return type. A subclass that widens the signature —
  // taking a required third argument — would be constructed here without it; that is a
  // subclass contract, like the static `schema`, and there is no way to state it in the type
  // system from inside the base class. `new (this.constructor as …)` is the only way to
  // re-run field initialisers, which is the point: `Object.create` would share `#shapes`.
  withTransaction(tx: { execute: Driver['execute'] }): this {
    const txDriver: Driver =
      this.driver.queryTelemetry === true
        ? { queryTelemetry: true, execute: q => tx.execute(q) }
        : { execute: q => tx.execute(q) };
    const ctor = this.constructor as new (driver: Driver, dialect?: Dialect) => this;
    return new ctor(txDriver, this.dialect);
  }

  private get schema(): CoreSchema<string> {
    // boundary: `this.constructor` is typed `Function`; there is no way to say
    // "the static side of my own class". The subclass contract is
    // `static readonly schema = …`, declared abstractly above.
    return (this.constructor as typeof BaseRepository).schema;
  }

  /**
   * One relation, by name, resolved from the declaration.
   *
   * No assertion, which is the difference from the static `relations` map this replaced:
   * `schema.ir.relations` is a field of the schema value every repository is handed, so
   * there is nothing to claim about `this.constructor`. The resolution itself lives in
   * `@zmdb/schema-core` because `compilePopulate` needs the same answer, and two resolvers
   * over one declaration is how the join and the batched select came to disagree before.
   */
  private relation(name: string): ResolvedRelation {
    return resolveRelation(this.schema.ir, name);
  }

  private get tableName(): string {
    return this.schema.table;
  }

  private get pkColumn(): string {
    const pk = this.schema.primaryKey[0];
    if (!pk) throw new Error(`schema ${this.tableName} has no primary key`);
    return pk;
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
    return this.decodeRows(await this.driver.execute(query)) as readonly Row[];
  }

  /**
   * The db→app crossing on the way out (plan D3).
   *
   * `Entity<T>` says a `timestamp` column is a `Date` and a `bigint` column is a `bigint`.
   * A driver may or may not agree: `pg` returns a `Date` for a `timestamptz` and a string
   * for an `int8`, and SQLite returns the `TEXT` it stored, because `TIMESTAMPTZ` and
   * `TEXT` is what the DDL emitter declares for those two dialects. So the row a caller
   * gets was, for one of the three dialects, not the type the type said — silently, since
   * nothing between the driver and the caller looked.
   *
   * Only the two columns whose app type JSON cannot carry can change, and a schema with
   * neither skips the walk entirely rather than copying every row to no effect.
   */
  private decodeRows(rows: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
    const columns = this.decodedColumns;
    if (columns.length === 0 || rows.length === 0) return rows;
    return rows.map(row => {
      const out: Record<string, unknown> = { ...row };
      for (const column of columns) {
        if (column.name in out) out[column.name] = decodeDbValue(column, out[column.name]);
      }
      return out;
    });
  }

  private get decodedColumns(): readonly ColumnIR[] {
    this.#decoded ??= dbDecodedColumns(this.schema.ir);
    return this.#decoded;
  }

  private buildKeyWhere(id: PrimaryKeyOf<T>, method: 'findById' | 'update' | 'delete'): WhereDTO<T> {
    const pkCols = this.schema.primaryKey;
    if (!pkCols || pkCols.length === 0) {
      throw new Error(`schema ${this.tableName} has no primary key`);
    }

    if (pkCols.length === 1) {
      const [pkCol] = pkCols;
      if (!pkCol) {
        throw new Error(`schema ${this.tableName} has empty primary key column`);
      }
      if (!isScalarKey(id)) {
        throw new ValidationError(
          `${this.tableName}.${method} requires the value of "${pkCol}", not ${describeKey(id)}`,
        );
      }
      // boundary: `pkCol` is dynamically read from `schema.primaryKey`; asserting to `WhereDTO<T>`
      // preserves the repository's concrete schema type `T`.
      return { [pkCol]: id } as WhereDTO<T>;
    }

    if (!isRecord(id) || id instanceof Date) {
      throw new ValidationError(`composite primary key for schema ${this.tableName} requires an object map`);
    }

    const where: Record<string, unknown> = {};
    for (const col of pkCols) {
      if (!(col in id) || id[col] === undefined) {
        throw new ValidationError(`missing composite primary key column "${col}" for schema ${this.tableName}`);
      }
      where[col] = id[col];
    }
    // boundary: `where` map is assembled at runtime from composite PK fields; asserting to `WhereDTO<T>`
    // preserves the repository's concrete schema type `T`.
    return where as WhereDTO<T>;
  }

  // #218 — typed populate. When `opts.populate` names relations the type declares, the
  // result is widened with those relations *and only those*. Batched IN query per relation;
  // no proxies. Populate keys are `RelationKeys<T>`, so a misspelled relation is a compile
  // error rather than the runtime throw in `resolveRelation`.
  async findById(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
  async findById<K extends RelationKeys<T> & string>(
    id: PrimaryKeyOf<T>,
    opts: { populate: readonly K[] },
  ): Promise<Populated<T, K> | undefined>;
  async findById(id: PrimaryKeyOf<T>, opts?: { populate?: readonly string[] }): Promise<Entity<T> | undefined> {
    return this.firstMatching(this.buildKeyWhere(id, 'findById'), opts?.populate);
  }

  /** The shared body of `findById` and `findOne`: first row for a where clause, relations attached if asked for. */
  private async firstMatching(where: WhereDTO<T>, populate?: readonly string[]): Promise<Entity<T> | undefined> {
    const q = compileWhere(this.qb.selectFrom(this.tableName), where).limit(1).compile();
    const rows = await this.rows<EntityRow<T>>(q);
    const row = rows[0];
    if (!row || !populate?.length) return row;
    const [populated] = await this.attachRelations([row], populate);
    return populated;
  }

  /**
   * The children of every parent in one query — using whereIn and parameter chunking — grouped by FK value.
   * A parent with no children is simply absent from the map.
   */
  private async childrenByParent(
    childTable: string,
    childFk: string,
    parentIds: readonly unknown[],
  ): Promise<Map<unknown, Record<string, unknown>[]>> {
    const ids = sanitizeKeys(parentIds);
    if (ids.length === 0) return new Map();
    // DIALECT_PARAM_LIMITS provides a conservative list-length heuristic threshold leaving parameter headroom below driver variable limits.
    const limit = DIALECT_PARAM_LIMITS[this.dialect] ?? 1000;
    const chunks = chunkArray(ids, limit);
    const children: Record<string, unknown>[] = [];
    for (const chunk of chunks) {
      const res = await this.driver.execute(this.qb.selectFrom(childTable).whereIn(childFk, chunk).compile());
      children.push(...res);
    }
    const byParent = new Map<unknown, Record<string, unknown>[]>();
    for (const c of children) {
      const key = c[childFk];
      const list = byParent.get(key) ?? [];
      list.push({ ...c });
      byParent.set(key, list);
    }
    return byParent;
  }

  /** Batch-load and attach named relations to parent rows without mutating inputs. */
  private async attachRelations<Row extends Record<string, unknown>>(
    parents: readonly Row[],
    names: readonly string[],
  ): Promise<readonly Row[]> {
    if (parents.length === 0) return parents;
    let current: Record<string, unknown>[] = parents.map(p => ({ ...p }));

    for (const name of names) {
      const rel = this.relation(name);
      const byParent = await this.childrenByParent(
        rel.targetTable,
        rel.targetKey,
        current.map(p => p[rel.parentKey]),
      );
      current = current.map(p => {
        const pKey = p[rel.parentKey];
        if (pKey === null || pKey === undefined) {
          return { ...p, [name]: rel.toMany ? [] : null };
        }
        const list = byParent.get(pKey) ?? [];
        return {
          ...p,
          [name]: rel.toMany ? list : (list[0] ?? null),
        };
      });
    }

    // boundary: populated rows are built by copying parent rows and attaching the relation
    // properties `Populated<T, K>` says are there.
    return current as unknown as readonly Row[];
  }

  async findOne<K extends RelationKeys<T> & string>(
    where: WhereDTO<T>,
    opts: { populate: readonly K[] },
  ): Promise<Populated<T, K> | undefined>;
  async findOne(where: WhereDTO<T>): Promise<Entity<T> | undefined>;
  async findOne(where: WhereDTO<T>, opts?: { populate?: readonly string[] }): Promise<Entity<T> | undefined> {
    return this.firstMatching(where, opts?.populate);
  }

  async find(where: WhereDTO<T>): Promise<readonly Entity<T>[]>;
  async find<K extends RelationKeys<T> & string>(
    where: WhereDTO<T>,
    opts: { populate: readonly K[] },
  ): Promise<readonly Populated<T, K>[]>;
  async find(where: WhereDTO<T>, opts?: { populate?: readonly string[] }): Promise<readonly Entity<T>[]> {
    const b = compileWhere(this.qb.selectFrom(this.tableName), where);
    const rows = await this.rows<EntityRow<T>>(b.compile());
    if (!opts?.populate?.length) return rows;
    return this.attachRelations(rows, opts.populate);
  }

  async findAll<K extends RelationKeys<T> & string>(opts: {
    populate: readonly K[];
  }): Promise<readonly Populated<T, K>[]>;
  async findAll(): Promise<readonly Entity<T>[]>;
  async findAll(opts?: { populate?: readonly string[] }): Promise<readonly Entity<T>[]> {
    const rows = await this.rows<EntityRow<T>>(this.qb.selectFrom(this.tableName).compile());
    if (!opts?.populate?.length) return rows;
    return this.attachRelations(rows, opts.populate);
  }

  async list<K extends RelationKeys<T> & string>(
    query: ListDTO<T> | undefined,
    opts: { populate: readonly K[] },
  ): Promise<ListResult<Populated<T, K>>>;
  async list(query?: ListDTO<T>): Promise<ListResult<Entity<T>>>;
  async list(query?: ListDTO<T>, opts?: { populate?: readonly string[] }): Promise<ListResult<Entity<T>>> {
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

    const rows = await this.rows<EntityRow<T>>(b.compile());
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
    const ftsTable = this.schema.ftsTable;
    const q = ftsSelectFrom(
      this.tableName,
      this.dialect,
      this.driver.queryTelemetry === true ? { ftsTable, telemetry: true } : { ftsTable },
    )
      .whereMatch(column, term)
      .compile();
    return this.driver.execute(q);
  }

  // #87 — JOIN integration. Fetch this table left-joined to a target on an FK,
  // filtered by a predicate on the base table. Returns flat joined rows (plain
  // objects — no proxies). Uses the query-compiler JOIN builder.
  async findJoined<Target extends DeclaredTable, Kind extends 'inner' | 'left' = 'left'>(
    join: { target: TaggedSchema<Target>; leftCol: string; rightCol: string; kind?: Kind },
    where?: { col: string; op: string; value: unknown },
  ): Promise<readonly JoinRow<Entity<T>, Entity<Target>, Kind>[]>;
  async findJoined<Joined = Record<string, unknown>, Kind extends 'inner' | 'left' = 'left'>(
    join: { target: string; leftCol: string; rightCol: string; kind?: Kind },
    where?: { col: string; op: string; value: unknown },
  ): Promise<readonly JoinRow<Entity<T>, Joined, Kind>[]>;
  async findJoined(
    join: { target: string | CoreSchema<string>; leftCol: string; rightCol: string; kind?: 'inner' | 'left' },
    where?: { col: string; op: string; value: unknown },
  ): Promise<readonly Record<string, unknown>[]> {
    const targetTable = typeof join.target === 'string' ? join.target : join.target.table;
    let b = joinableSelectFrom(
      this.tableName,
      this.dialect,
      this.driver.queryTelemetry === true ? { telemetry: true } : undefined,
    );
    b = (join.kind === 'inner' ? b.innerJoin : b.leftJoin).call(b, targetTable, join.leftCol, join.rightCol);
    if (where) b = b.where(where.col, where.op, where.value);
    return this.driver.execute(b.compile());
  }

  /**
   * A relation as a join: the target table, aliased to the relation name, and the two columns.
   *
   * One expression for both directions, where the map-driven version needed a branch per
   * cardinality — the two spellings put the joining column under a different key depending
   * on which side owned it (`fk` on the owning side, `mappedBy` on the inverse), and each
   * arm then had a fallback that guessed a column name from the table name. `parentKey` and
   * `targetKey` are already the answer to "which column on which side", so there is nothing
   * left to guess and no default to be wrong about.
   */
  protected resolveRelationJoin(relationName: string): {
    targetTable: string;
    leftCol: string;
    rightCol: string;
  } {
    const rel = this.relation(relationName);
    const alias = relationName.trim();
    const targetTable =
      rel.targetTable.toLowerCase() === alias.toLowerCase() ? rel.targetTable : `${rel.targetTable} as ${alias}`;
    return {
      targetTable,
      leftCol: `${this.tableName}.${rel.parentKey}`,
      rightCol: `${alias}.${rel.targetKey}`,
    };
  }

  private createRepositoryAggregateBuilder(): RepositoryAggregateBuilder {
    let builder = aggregateSelectFrom(
      this.tableName,
      this.dialect,
      this.driver.queryTelemetry === true ? { telemetry: true } : undefined,
    );
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
    specOrBuild: AggregateSpec<T> | ((agg: RepositoryAggregateBuilder) => { compile(): CompiledQuery } | void),
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
      let builder = aggregateSelectFrom(
        this.tableName,
        this.dialect,
        this.driver.queryTelemetry === true ? { telemetry: true } : undefined,
      );
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

      const relationNames = new Set(this.schema.ir.relations.map(rel => rel.name));
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
          if (relCandidate && relationNames.has(relCandidate)) {
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

    // boundary: the same claim `rows<Row>` makes, and for the same reason — the aggregate
    // query that just ran is what decides the shape, and a driver row is opaque. It does not
    // go through `rows` because an aggregate row is not an entity row: `decodeRows` would
    // walk it looking for this table's `timestamp` and `bigint` columns, and `COUNT(*)`
    // is not one of them.
    return mappedRows as readonly Out[];
  }

  // #34 — explicit populate for a to-many relation. Loads parents, then batches
  // one IN() query for children, and attaches them under `relationName`. No
  // proxies, no identity map — children are plain rows on plain parents.
  async findAllWithMany<K extends RelationKeys<T> & string>(relationName: K): Promise<readonly Populated<T, K>[]>;
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
    const fetched = await this.rows<EntityRow<T>>(this.qb.selectFrom(this.tableName).compile());
    if (fetched.length === 0) return fetched;
    // Without an explicit child table/FK the relation has to be looked up, which
    // is what attachRelations does; with one, the caller has already told us
    // everything the batched fetch needs.
    if (!childTable || !childFk) return this.attachRelations(fetched, [relationName]);
    const byParent = await this.childrenByParent(
      childTable,
      childFk,
      fetched.map(p => p[parentKey]),
    );
    return fetched.map(p => ({
      ...p,
      [relationName]: byParent.get(p[parentKey]) ?? [],
    }));
  }

  // #207 — typed create/update. Signatures are the derived DTOs; runtime reuses
  // validatePayload (validate-before-SQL) unchanged.
  async create(dto: CreateDTO<T>): Promise<Entity<T>> {
    const clean = this.validatePayload(dto, 'create');
    this.preInsert(clean);
    const rows = await this.rows<EntityRow<T>>(
      this.qb.insertInto(this.tableName).values(clean).returning(['*']).compile(),
    );
    const row = rows[0];
    if (!row) throw new Error(`insert into ${this.tableName} returned no row`);
    this.postInsert(row);
    return row;
  }

  async upsert(dto: CreateDTO<T>, opts?: UpsertOptions): Promise<Entity<T> | undefined> {
    const clean = this.validatePayload(dto, 'create');
    this.preInsert(clean);
    const target = opts?.target ?? this.schema.primaryKey;
    const ib = this.qb.insertInto(this.tableName).values(clean).onConflict(target).doUpdate(opts?.updateFields);
    const rows = await this.rows<EntityRow<T>>(ib.returning(['*']).compile());
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    this.postInsert(row);
    return row;
  }

  async update(id: PrimaryKeyOf<T>, patch: UpdateDTO<T>): Promise<Entity<T> | undefined> {
    const clean = this.validatePayload(patch, 'update');
    this.preUpdate(clean);
    // Built before the empty-patch shortcut so that a bad key is reported as `update` rather
    // than as the `findById` it would otherwise delegate to (§2.1: "the method in the message
    // is the method the caller actually called").
    const where = this.buildKeyWhere(id, 'update');
    if (Object.keys(clean).length === 0) {
      return this.firstMatching(where);
    }
    const rows = await this.rows<EntityRow<T>>(
      this.assertKeyed(
        compileWhere(this.qb.updateTable(this.tableName).set(clean), where).returning(['*']).compile(),
        'update',
      ),
    );
    return rows[0];
  }

  /**
   * Refuse a keyed write that lost its `WHERE`.
   *
   * `update` and `delete` build the where clause themselves out of a primary key, so
   * neither has a legitimate unkeyed form and an empty clause is always a bug. The
   * check is here rather than only in the layers that can produce one because the cost
   * of being wrong is the whole table, and it survives a new operator, a new caller, or
   * a fourth way of folding a spec down to nothing (#608).
   */
  private assertKeyed(query: CompiledQuery, operation: 'update' | 'delete'): CompiledQuery {
    if (!/\sWHERE\s/i.test(query.text)) {
      throw new ValidationError(
        `refusing to ${operation} every row of ${this.tableName}: the compiled statement has no WHERE clause`,
      );
    }
    return query;
  }

  // #28 — delete + lifecycle hooks.
  async delete(id: PrimaryKeyOf<T>): Promise<boolean> {
    this.preDelete(id);
    const where = this.buildKeyWhere(id, 'delete');
    const rows = await this.driver.execute(
      this.assertKeyed(
        compileWhere(this.qb.deleteFrom(this.tableName), where).returning(this.schema.primaryKey).compile(),
        'delete',
      ),
    );
    return rows.length > 0;
  }

  // Explicit, synchronous lifecycle hooks. No hidden change tracking — these
  // fire only around the corresponding operation, in documented order.
  protected preInsert(_row: Record<string, unknown>): void {}
  protected postInsert(_row: Record<string, unknown>): void {}
  protected preUpdate(_row: Record<string, unknown>): void {}
  protected preDelete(_id: PrimaryKeyOf<T>): void {}
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

  /**
   * One write variant's columns, and the object type they add up to.
   *
   * Built once per repository instance per variant. `this.schema` is a static and never
   * changes, so neither can the IR; without the cache every `create` would walk the
   * columns again to rebuild an identical object graph.
   */
  private payloadShape(variant: 'create' | 'update'): PayloadShape {
    const cached = this.#shapes.get(variant);
    if (cached) return cached;
    const shape = shapeOfVariant(this.schema.ir, variant);
    const built = {
      shape,
      type: objectTypeFromShape(shape),
      accepted: new Set(shape.map(({ column }) => column.name)),
    };
    this.#shapes.set(variant, built);
    return built;
  }

  /**
   * One issue per key the payload has and this variant does not accept (REQ-RP-3).
   *
   * These used to be dropped in silence, which made two mistakes invisible. A misspelled
   * column — `{ emial: 'a@b.co' }` — reported only that `email` was missing, and a
   * supplied `id` on a serial key reported nothing at all: the insert went through with a
   * key the database was about to generate, so the payload the caller wrote and the row
   * that came back disagreed and nothing said so.
   *
   * Reported alongside the structural issues rather than only when there are none, which
   * is where this deliberately differs from `assertEquals`'s excess check. Its rule is
   * that "you also passed `extra`" is noise next to "`email` is not a string", and at a
   * table boundary it usually is not noise: the excess key is a typo *of* the column the
   * other issue is complaining about, and suppressing it hides the answer.
   */
  private excessIssues(obj: Record<string, unknown>, variant: 'create' | 'update'): ValidationIssue[] {
    const { accepted } = this.payloadShape(variant);
    const issues: ValidationIssue[] = [];
    for (const key of Object.keys(obj)) {
      if (accepted.has(key)) continue;
      // `hasOwn`, because `columns['constructor']` is not a column.
      const column = Object.hasOwn(this.schema.columns, key) ? this.schema.columns[key] : undefined;
      const message = !column
        ? `"${key}" is not a column of "${this.tableName}"`
        : column.flags.autoIncrement
          ? `the database generates "${key}", so a payload cannot supply it`
          : `"${key}" identifies the row and cannot be patched`;
      issues.push({ path: `input.${key}`, message, expected: 'no excess properties', value: obj[key] });
    }
    return issues;
  }

  /**
   * Runtime validation of a write payload — the type of the payload, checked by the one
   * runtime walker.
   *
   * This used to be a walk of its own over `ColumnMeta`, and it was the fourth of the
   * four that `@zmdb/schema-core/ir` exists to collapse: it accepted `Date | string` for
   * a `timestamp` while the published document said ISO string and `Entity<T>` said
   * `Date`, and it had no notion of `Min`/`Max`/`Pattern` at all, so a repository write
   * skipped every bound the schema declared and the same value was rejected only later,
   * at the HTTP edge, by a different validator. What it needed was not a walk but the
   * *type* of a `CreateDTO`, which `objectTypeFromShape` produces from the same IR the
   * documents come from.
   *
   * The app layer, not the wire layer: a caller here holds a `Date`, having decoded the
   * request body already. A handler that has not is the boundary case `Wire<T>` is for.
   *
   * A key the variant does not accept is an issue, not something to drop — see
   * `excessIssues`.
   */
  private validatePayload(payload: unknown, variant: 'create' | 'update'): Record<string, unknown> {
    if (!isRecord(payload)) {
      throw new ValidationError('payload must be an object', [
        { path: 'input', message: 'expected object', expected: 'object', value: payload },
      ]);
    }
    const obj = this.sanitizePayload(payload);
    const { shape, type } = this.payloadShape(variant);
    const issues = [...issuesFor(obj, type), ...this.excessIssues(obj, variant)];

    if (issues.length > 0) {
      throw new ValidationError(`validation failed: ${issues.map(i => i.path).join(', ')}`, issues);
    }

    const out: Record<string, unknown> = {};
    for (const { column } of shape) {
      if (column.name in obj) out[column.name] = obj[column.name];
    }
    return out;
  }
}

// #223 — wiring helper. Bind a schema to a driver and get a fully typed repository
// instance without writing a subclass. There used to be a `relations` option here; the
// relations are on `T`, which `schema` carries, so passing them again was the second
// spelling this design exists to remove.
export interface DefineRepositoryOptions {
  dialect?: Dialect;
}
export function defineRepository<T extends DeclaredTable>(
  schema: TaggedSchema<T>,
  driver: Driver,
  opts?: DefineRepositoryOptions,
): BaseRepository<T> {
  // Anonymous subclass binding the schema as a static, exactly like a hand-written
  // subclass — no proxies, no magic.
  class Repo extends BaseRepository<T> {
    static override readonly schema = schema;
  }
  return new Repo(driver, opts?.dialect ?? 'postgres');
}

export * from './transactions/index.js';
