// @zmdb/repository — the repository layer: reads (#26), writes (#27), delete +
// lifecycle hooks (#28), transactions (#37), typed populate (#217) and the
// no-subclass wiring helper (#223). Every SQL statement comes from
// @zmdb/query-compiler and every type from the schema; there is no runtime
// reflection, no proxies and no identity map.
import { issuesFor } from '@zmdb/aot-validator/utilities';
import type { ColumnExpr, CompiledQuery, Dialect, Predicate, SelectBuilder, SetValue } from '@zmdb/query-compiler';
import { chunkArray, createQueryCompiler, DIALECT_PARAM_LIMITS, EXPR, inc, sanitizeKeys } from '@zmdb/query-compiler';
import { aggregateSelectFrom, type AggregateSelect } from '@zmdb/query-compiler/aggregations';
import { ftsSelectFrom } from '@zmdb/query-compiler/fts';
import { joinableSelectFrom } from '@zmdb/query-compiler/joins';
import type { RoutineDef } from '@zmdb/query-compiler/schema-objects';
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
import type { KeysCarrying, Populated, RelationKeys } from '@zmdb/schema-core/derive';
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
  type WhereTarget,
} from '@zmdb/schema-core/dto';
import {
  appTypeOf,
  dbDecodedColumns,
  decodeDbValue,
  objectTypeFromShape,
  SQL_TYPES,
  shapeOfVariant,
  type ColumnIR,
  type ObjectIR,
  type ShapeIR,
  type TypeIR,
} from '@zmdb/schema-core/ir';
import type { Sql } from '@zmdb/schema-core/tags';

import {
  cacheTags,
  copyCachedRows,
  memoryStore,
  resultCacheKey,
  type CacheInvalidationOptions,
  type CacheOptions,
  type CacheStore,
} from './cache/index.js';
import {
  applyResolvedFilters,
  filtersAsPredicates,
  resolveFilters,
  type FilterDef,
  type FilterOverrides,
  type FilterTarget,
  type ResolvedFilters,
} from './filters/index.js';
import {
  createEntityLoader,
  createRelationLoader,
  LOADER_ENTITY_BATCH,
  LOADER_ENTITY_KEY,
  LOADER_FOR_SCOPE,
  LOADER_RELATION_BATCH,
  LOADER_RELATION_KEY,
  RELATION_LOADER_FOR_SCOPE,
  type EntityLoader,
  type RelationLoader,
  type RelationValueOf,
} from './loaders/index.js';

export interface Driver {
  readonly dialect?: Dialect;
  /** Enables compile-time query attributes when an execution wrapper consumes them. */
  readonly queryTelemetry?: true;
  execute(query: CompiledQuery): Promise<readonly Record<string, unknown>[]>;
}

export interface QueryMeta {
  readonly filters: readonly string[];
  readonly buffered?: boolean;
}

export interface RepositoryOptions {
  readonly cacheStore?: CacheStore;
  readonly filters?: readonly FilterDef<unknown>[];
  readonly onQuery?: (query: CompiledQuery, meta: QueryMeta) => void;
}

export interface ReadOptions<Defs extends readonly FilterDef<unknown>[] = readonly FilterDef<unknown>[]> {
  readonly cache?: CacheOptions | false;
  readonly filters?: FilterOverrides<Defs>;
}

type PopulateReadOptions<K extends string> = ReadOptions & {
  readonly populate: readonly K[];
};

type InternalReadOptions = ReadOptions & {
  readonly populate?: readonly string[];
};

interface ReadBuilder extends FilterTarget {
  compile(): CompiledQuery;
}

interface ReadCompileSettings {
  readonly table?: string;
  readonly columnPrefix?: string;
  readonly schema?: CoreSchema<string>;
  readonly qualifyColumns?: boolean;
  readonly filtersApplied?: boolean;
  readonly additionalFilterNames?: readonly string[];
  readonly additionalKnownNames?: readonly string[];
  readonly resolvedFilters?: ResolvedFilters;
}

function parseTableSpec(spec: string): { readonly table: string; readonly reference: string } {
  const match = /^(\S+)(?:\s+(?:as\s+)?(\S+))?$/i.exec(spec.trim());
  const table = match?.[1] ?? spec.trim();
  return { table, reference: match?.[2] ?? table };
}

function isFilterDef(value: unknown): value is FilterDef<unknown> {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.where === 'function' &&
    (value.table === undefined || typeof value.table === 'string') &&
    (value.schema === undefined ||
      (isRecord(value.schema) && typeof value.schema.table === 'string' && isRecord(value.schema.ir))) &&
    (value.enabled === undefined || typeof value.enabled === 'boolean') &&
    (value.appliesToWrites === undefined || typeof value.appliesToWrites === 'boolean')
  );
}

function staticFiltersFor(constructor: Function): readonly FilterDef<unknown>[] {
  const value: unknown = Reflect.get(constructor, 'filters');
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every(isFilterDef)) {
    throw new ValidationError('repository static filters must be an array of filter definitions');
  }
  return value;
}

/**
 * A fetched row: the derived entity plus the string-keyed view that populate
 * writes relations onto. The intersection (rather than `Entity<T>` alone) is what
 * makes keyed access legal without asserting.
 */
type EntityRow<T extends DeclaredTable> = Entity<T> & Record<string, unknown>;

type RelationLoaderMap<T extends DeclaredTable> = {
  [K in RelationKeys<T> & string]?: RelationLoader<T, K>;
};

export interface RepositoryAggregateBuilder extends ReturnType<typeof aggregateSelectFrom> {
  joinRelation(relationName: string, kind?: 'inner' | 'left' | 'right'): RepositoryAggregateBuilder;
}

export { ValidationError, type ValidationIssue };

/** A composite key omitted one or more required own properties. */
export class IncompleteKeyError extends ValidationError {
  readonly table: string;
  readonly missing: readonly string[];

  constructor(table: string, method: 'findById' | 'update' | 'delete', missing: readonly string[]) {
    const orderedMissing = Object.freeze([...missing]);
    super(`${table}.${method} requires every key column; missing: ${orderedMissing.join(', ')}`);
    this.name = 'IncompleteKeyError';
    this.table = table;
    this.missing = orderedMissing;
  }
}

/** A literal value or a compiler-owned expression, per updatable column. */
export type UpdatePatch<T extends DeclaredTable> = {
  readonly [K in keyof UpdateDTO<T>]?: SetValue<UpdateDTO<T>[K]>;
};

type NumericSqlKeys<T extends DeclaredTable> =
  | KeysCarrying<T, Sql<'integer'>>
  | KeysCarrying<T, Sql<'bigint'>>
  | KeysCarrying<T, Sql<'numeric'>>;

type NumericAppKeys<T extends DeclaredTable> = {
  [K in keyof T]-?: NonNullable<T[K]> extends number | bigint ? K : never;
}[keyof T];

/** Updatable columns whose declared app value and SQL storage are both numeric. */
export type NumericColumnOf<T extends DeclaredTable> = Extract<
  NumericSqlKeys<T>,
  NumericAppKeys<T> & keyof UpdateDTO<T> & string
>;

type NumericOperandOf<T extends DeclaredTable, K extends NumericColumnOf<T>> = Exclude<
  UpdateDTO<T>[K],
  null | undefined
>;

type UpsertUpdateFields<T extends DeclaredTable> = [T] extends [never]
  ? readonly string[] | Record<string, unknown>
  : readonly (keyof UpdateDTO<T> & string)[] | UpdatePatch<T>;

export interface UpsertOptions<T extends DeclaredTable = never> extends CacheInvalidationOptions {
  readonly target?: string | readonly string[] | undefined;
  readonly updateFields?: UpsertUpdateFields<T> | undefined;
}

type RoutineType = RoutineDef['params'][number]['type'];

type RoutineAppType<T extends RoutineType | 'void'> = T extends 'serial' | 'integer' | 'numeric'
  ? number
  : T extends 'bigint'
    ? bigint
    : T extends 'boolean'
      ? boolean
      : T extends 'timestamp'
        ? Date
        : T extends 'text' | 'varchar' | 'jsonEnum'
          ? string
          : T extends 'json'
            ? unknown
            : void;

type RoutineAppTypeOfParam<P> = P extends { readonly type: infer T extends RoutineType } ? RoutineAppType<T> : never;

type ArgsFromRoutineParams<P extends readonly RoutineDef['params'][number][]> = P extends readonly []
  ? readonly []
  : P extends readonly [infer Head, ...infer Tail extends readonly RoutineDef['params'][number][]]
    ? readonly [RoutineAppTypeOfParam<Head>, ...ArgsFromRoutineParams<Tail>]
    : readonly RoutineAppTypeOfParam<P[number]>[];

/** The app-layer argument tuple derived from a routine declaration. */
export type ArgsOf<D extends RoutineDef> = ArgsFromRoutineParams<D['params']>;

/** The app-layer result derived from a routine declaration. */
export type ResultOf<D extends RoutineDef> = D['kind'] extends 'procedure'
  ? void
  : D['returns'] extends {
        readonly type: infer T extends RoutineType | 'void';
        readonly setof: true;
      }
    ? readonly RoutineAppType<T>[]
    : D['returns'] extends { readonly type: infer T extends RoutineType | 'void' }
      ? RoutineAppType<T>
      : void;

const ROUTINE_SQL_TYPES = new Set<string>(SQL_TYPES);

function isRoutineDefinition(value: unknown): value is RoutineDef {
  if (!isRecord(value)) return false;
  if (value.kind !== 'function' && value.kind !== 'procedure') return false;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return false;
  if (typeof value.body !== 'string' || !Array.isArray(value.params)) return false;
  if (value.language !== undefined && typeof value.language !== 'string') return false;
  if (value.deterministic !== undefined && typeof value.deterministic !== 'boolean') return false;

  for (const param of value.params) {
    if (!isRecord(param)) return false;
    if (typeof param.name !== 'string' || param.name.trim().length === 0) return false;
    if (typeof param.type !== 'string' || !ROUTINE_SQL_TYPES.has(param.type)) return false;
    if (param.mode !== undefined && param.mode !== 'in' && param.mode !== 'out' && param.mode !== 'inout') {
      return false;
    }
  }

  if (value.returns !== undefined) {
    if (!isRecord(value.returns)) return false;
    if (
      typeof value.returns.type !== 'string' ||
      (value.returns.type !== 'void' && !ROUTINE_SQL_TYPES.has(value.returns.type))
    ) {
      return false;
    }
    if (value.returns.setof !== undefined && typeof value.returns.setof !== 'boolean') return false;
  }
  return true;
}

function routineColumn(name: string, sql: RoutineType): ColumnIR {
  return {
    name,
    physicalName: name,
    sql,
    nullable: false,
    primaryKey: false,
    serial: false,
    unique: false,
    hasDefault: false,
    sensitive: false,
    constraints: {},
    rules: [],
    // A routine declaration carries only the SQL type, so bare JSON has no
    // narrower payload witness and is correctly validated as unknown.
    ...(sql === 'json' ? { payload: { kind: 'unknown' } as const } : {}),
  };
}

function validatedRoutineValue(value: unknown, type: TypeIR): unknown {
  const issues = issuesFor(value, type, 'result');
  if (issues.length > 0) {
    throw new ValidationError(`validation failed: ${issues.map(issue => issue.path).join(', ')}`, issues);
  }
  return value;
}

/**
 * Whether a value can be a single-column primary key.
 *
 * The composite branch of `keyWhere` has always refused a key that is missing a
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
  if (value instanceof Date) return 'a Date';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return typeof value === 'function' ? 'a function' : `a ${typeof value}`;
}

/** Type-tag one SQL key value so values such as `1`, `'1'` and `1n` cannot collide. */
function loaderKeyPart(value: unknown): string {
  if (value instanceof Date) return `d:${value.getTime()}`;
  if (value === null) return 'z:';
  if (value === undefined) return 'u:';
  if (typeof value === 'string') return `s:${value.length}:${value}`;
  if (typeof value === 'number') return `n:${String(value)}`;
  if (typeof value === 'bigint') return `i:${String(value)}`;
  if (typeof value === 'boolean') return `b:${String(value)}`;
  throw new ValidationError(`dataloader keys must be SQL scalar values; got ${describeKey(value)}`);
}

/** Length-prefix each tagged part so composite-key boundaries are unambiguous. */
function loaderKey(parts: readonly unknown[]): string {
  return parts
    .map(value => loaderKeyPart(value))
    .map(part => `${part.length}:${part}`)
    .join('');
}

/** Everything a write variant's validation needs, derived once. See `payloadShape`. */
interface PayloadShape {
  readonly shape: ShapeIR;
  readonly type: ObjectIR;
  /** The column names this variant accepts, for the excess check. */
  readonly accepted: ReadonlySet<string>;
  /** The same accepted columns, keyed for expression-operand validation. */
  readonly columns: ReadonlyMap<string, ColumnIR>;
}

const NO_EXPRESSION_OPERAND: unique symbol = Symbol('zmdb.no-expression-operand');

function isColumnExpression(value: unknown): value is ColumnExpr<unknown> {
  return typeof value === 'object' && value !== null && EXPR in value;
}

function expressionOperand(expression: ColumnExpr<unknown>): unknown | typeof NO_EXPRESSION_OPERAND {
  switch (expression.op) {
    case 'add':
    case 'sub':
    case 'mul':
      return expression.by;
    case 'concat':
      return expression.with;
    case 'coalesce':
      return expression.fallback;
    case 'not':
    case 'proposed':
      return NO_EXPRESSION_OPERAND;
  }
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
  /** Ordered primary-key columns, resolved once because a repository's schema cannot change. */
  private readonly keyColumns: readonly string[];
  /** variant → its columns and their object type. See `payloadShape`. */
  readonly #shapes = new Map<'create' | 'update', PayloadShape>();
  /** The columns a driver may hand back in their storage form. See `decodeRows`. */
  #decoded: readonly ColumnIR[] | undefined;
  /** Undefined until a custom store is supplied or an opted-in read needs the bounded default. */
  #cacheStore: CacheStore | undefined;
  #cacheFailureReported = false;
  readonly #optionFilters: readonly FilterDef<unknown>[];
  readonly #filterDefinitions: readonly FilterDef<unknown>[];
  readonly #onQuery: RepositoryOptions['onQuery'];
  readonly #queryFilters = new WeakMap<CompiledQuery, readonly string[]>();
  /** Loader state is keyed by the explicit request-scope token, never globally. */
  readonly #entityLoaders = new WeakMap<object, EntityLoader<T>>();
  readonly #relationLoaders = new WeakMap<object, RelationLoaderMap<T>>();

  constructor(driver: Driver, dialect: Dialect = 'postgres', options?: RepositoryOptions) {
    this.driver = driver;
    this.dialect = dialect;
    this.#cacheStore = options?.cacheStore;
    this.#optionFilters = Object.freeze([...(options?.filters ?? [])]);
    const staticFilters = staticFiltersFor(this.constructor);
    this.#filterDefinitions = Object.freeze(
      [...staticFilters, ...this.#optionFilters].map(filter => {
        if (filter.table !== undefined && filter.schema !== undefined && filter.table !== filter.schema.table) {
          throw new ValidationError(
            `filter \`${filter.name}\` targets \`${filter.table}\` but its schema declares \`${filter.schema.table}\``,
          );
        }
        return filter.table === undefined ? { ...filter, table: filter.schema?.table ?? this.schema.table } : filter;
      }),
    );
    this.#onQuery = options?.onQuery;
    this.qb = createQueryCompiler(dialect, driver.queryTelemetry === true ? { telemetry: true } : undefined);
    this.keyColumns = Object.freeze([...this.schema.primaryKey]);

    const seen = new Set<string>();
    for (const filter of this.#filterDefinitions) {
      if (filter.name.trim().length === 0) throw new ValidationError('filter names must not be empty');
      const identity = `${filter.table ?? this.schema.table}\u0000${filter.name}`;
      if (seen.has(identity)) {
        throw new ValidationError(`filter \`${filter.name}\` is declared more than once for \`${filter.table}\``);
      }
      seen.add(identity);
    }
  }

  [LOADER_FOR_SCOPE](scope: object): EntityLoader<T> {
    const existing = this.#entityLoaders.get(scope);
    if (existing) return existing;
    const created = createEntityLoader(this);
    this.#entityLoaders.set(scope, created);
    return created;
  }

  [RELATION_LOADER_FOR_SCOPE]<K extends RelationKeys<T> & string>(scope: object, relation: K): RelationLoader<T, K> {
    let loaders = this.#relationLoaders.get(scope);
    if (!loaders) {
      loaders = {};
      this.#relationLoaders.set(scope, loaders);
    }

    const existing = Object.hasOwn(loaders, relation) ? loaders[relation] : undefined;
    if (existing) return existing;

    const created = createRelationLoader(this, relation);
    Object.defineProperty(loaders, relation, {
      configurable: false,
      enumerable: true,
      value: created,
      writable: false,
    });
    return created;
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
    const ctor = this.constructor as new (driver: Driver, dialect?: Dialect, options?: RepositoryOptions) => this;
    const options: RepositoryOptions = {
      ...(this.#cacheStore === undefined ? {} : { cacheStore: this.#cacheStore }),
      ...(this.#optionFilters.length === 0 ? {} : { filters: this.#optionFilters }),
      ...(this.#onQuery === undefined ? {} : { onQuery: this.#onQuery }),
    };
    return new ctor(txDriver, this.dialect, Object.keys(options).length === 0 ? undefined : options);
  }

  /**
   * Call one declared stored function or procedure.
   *
   * A repository rebound with `withTransaction` uses that transaction's driver
   * here too. The routine body is opaque, so zmdb cannot detect transaction
   * control inside it; callers must not put an internally committing procedure
   * inside an outer transaction.
   */
  protected call<D extends RoutineDef>(definition: D, args: ArgsOf<D>): Promise<ResultOf<D>>;
  protected async call(definition: RoutineDef, args: readonly unknown[]): Promise<unknown> {
    if (!isRoutineDefinition(definition)) {
      throw new ValidationError('routine calls require a declared RoutineDef', [
        {
          path: 'routine',
          message: 'expected a declared routine definition, not a caller-supplied name',
          expected: 'RoutineDef',
          value: definition,
        },
      ]);
    }
    if (!Array.isArray(args)) {
      throw new ValidationError(`routine "${definition.name}" arguments must be a tuple`, [
        { path: 'input', message: 'expected array', expected: 'array', value: args },
      ]);
    }

    const unsupported = definition.params.find(param => param.mode === 'out' || param.mode === 'inout');
    if (unsupported) {
      throw new ValidationError(
        `routine "${definition.name}" parameter "${unsupported.name}" uses unsupported mode "${unsupported.mode}"`,
      );
    }
    if (args.length !== definition.params.length) {
      throw new ValidationError(
        `routine "${definition.name}" expects ${definition.params.length} argument(s), received ${args.length}`,
        [
          {
            path: 'input',
            message: `expected ${definition.params.length} argument(s), received ${args.length}`,
            expected: `tuple of length ${definition.params.length}`,
            value: args,
          },
        ],
      );
    }

    const seenNames = new Set<string>();
    const input: Record<string, unknown> = {};
    const shape: ShapeIR = definition.params.map((param, index) => {
      if (seenNames.has(param.name)) {
        throw new ValidationError(`routine "${definition.name}" declares parameter "${param.name}" more than once`);
      }
      seenNames.add(param.name);
      input[param.name] = args[index];
      return { column: routineColumn(param.name, param.type), optional: false };
    });

    // Binding protects the outer SQL call, but not dynamic SQL inside an opaque
    // routine body. A routine may also run with definer rights, so every
    // argument is validated before even compiling the privileged call.
    const argumentIssues = issuesFor(input, objectTypeFromShape(shape));
    if (argumentIssues.length > 0) {
      throw new ValidationError(
        `validation failed: ${argumentIssues.map(issue => issue.path).join(', ')}`,
        argumentIssues,
      );
    }

    const query =
      definition.kind === 'procedure'
        ? this.qb.callProcedure(definition.name, args)
        : definition.returns?.setof === true
          ? this.qb.callTableFunction(definition.name, args)
          : this.qb.callFunction(definition.name, args);
    const rows = await this.driver.execute(query);

    if (definition.kind === 'procedure' || definition.returns === undefined || definition.returns.type === 'void') {
      return validatedRoutineValue(undefined, { kind: 'undefined' });
    }

    const column = routineColumn(definition.name, definition.returns.type);
    const resultType = appTypeOf(column);
    if (definition.returns.setof === true) {
      const values = rows.map(row => decodeDbValue(column, row[definition.name]));
      return validatedRoutineValue(values, { kind: 'array', element: resultType });
    }

    const value = decodeDbValue(column, rows[0]?.result);
    return validatedRoutineValue(value, resultType);
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

  private filterDefinitionsFor(table: string, schema?: CoreSchema<string>): readonly FilterDef<unknown>[] {
    const definitions = this.#filterDefinitions.filter(filter => filter.table === table);
    const softDelete = schema?.ir.softDelete;
    if (softDelete === undefined || definitions.some(filter => filter.name === 'softDelete')) {
      return definitions;
    }
    return [
      ...definitions,
      {
        name: 'softDelete',
        table,
        where: (_params: unknown) => [
          {
            col: softDelete.column,
            op: 'is null',
            value: undefined,
          },
        ],
      },
    ];
  }

  private knownFilterNames(
    definitions: readonly FilterDef<unknown>[],
    additional: readonly string[] = [],
  ): readonly string[] {
    return [...new Set([...definitions.map(filter => filter.name), ...additional])];
  }

  private rootFilterNames(): readonly string[] {
    return this.filterDefinitionsFor(this.tableName, this.schema).map(filter => filter.name);
  }

  private allDeclaredFilterNames(): readonly string[] {
    return [...new Set([...this.rootFilterNames(), ...this.#filterDefinitions.map(filter => filter.name)])];
  }

  private populateFilterNames(names: readonly string[] | undefined): readonly string[] {
    const known = new Set(this.rootFilterNames());
    for (const name of names ?? []) {
      const relation = this.relation(name);
      for (const filter of this.filterDefinitionsFor(relation.targetTable)) known.add(filter.name);
    }
    return [...known];
  }

  private resolveReadFilters(
    method: string,
    options: ReadOptions | undefined,
    table: string,
    schema: CoreSchema<string> | undefined,
    qualifyColumns: boolean,
    additionalKnownNames: readonly string[] = [],
    columnPrefix = table,
  ): ResolvedFilters {
    const definitions = this.filterDefinitionsFor(table, schema);
    return resolveFilters(definitions, options?.filters, {
      method,
      table,
      columnPrefix,
      ...(schema === undefined ? {} : { schema }),
      ...(qualifyColumns ? { qualifyColumns: true } : {}),
      knownNames: this.knownFilterNames(definitions, additionalKnownNames),
    });
  }

  /**
   * The only place a repository read becomes a CompiledQuery.
   *
   * Filter parameters are resolved before `build` runs, the resolved predicates
   * are conjoined unless a structurally richer builder already placed them, and
   * the same point reports the final SQL plus the applied names.
   */
  private compileRead<B extends ReadBuilder>(
    method: string,
    options: ReadOptions | undefined,
    build: (filters: ResolvedFilters) => B,
    settings: ReadCompileSettings = {},
  ): CompiledQuery {
    const table = settings.table ?? this.tableName;
    const schema = settings.schema ?? (table === this.tableName ? this.schema : undefined);
    const resolved =
      settings.resolvedFilters ??
      this.resolveReadFilters(
        method,
        options,
        table,
        schema,
        settings.qualifyColumns === true,
        settings.additionalKnownNames,
        settings.columnPrefix,
      );
    const built = build(resolved);
    const filtered = settings.filtersApplied === true ? built : applyResolvedFilters(built, resolved);
    const query = filtered.compile();
    const names = Object.freeze([...new Set([...resolved.names, ...(settings.additionalFilterNames ?? [])])]);
    this.#queryFilters.set(query, names);
    this.#onQuery?.(query, { filters: names });
    return query;
  }

  private resolvePopulateFilters(
    names: readonly string[] | undefined,
    options: ReadOptions | undefined,
  ): ReadonlyMap<string, ResolvedFilters> {
    const byRelation = new Map<string, ResolvedFilters>();
    const byTable = new Map<string, ResolvedFilters>();
    const knownNames = this.populateFilterNames(names);
    for (const name of names ?? []) {
      const relation = this.relation(name);
      let resolved = byTable.get(relation.targetTable);
      if (resolved === undefined) {
        resolved = this.resolveReadFilters('populate', options, relation.targetTable, undefined, true, knownNames);
        byTable.set(relation.targetTable, resolved);
      }
      byRelation.set(name, resolved);
    }
    return byRelation;
  }

  private requiredKeyColumns(): readonly string[] {
    if (this.keyColumns.length === 0) throw new Error(`schema ${this.tableName} has no primary key`);
    return this.keyColumns;
  }

  /**
   * The one row-shape trust boundary in this package (ARCHITECTURE §2.1).
   *
   * A driver or configured cache store hands back structurally opaque values;
   * the compiled query and schema fingerprint decide their shape, so exactly one
   * assertion re-types them for the caller. Every read method funnels through
   * here instead of asserting at its own return statement.
   */
  private async rows<Row>(query: CompiledQuery, cache?: CacheOptions | false): Promise<readonly Row[]> {
    let value: unknown;
    if (cache === undefined || cache === false) {
      value = this.decodeRows(await this.driver.execute(query));
    } else {
      value = await this.cachedRows(query, cache);
    }

    // boundary: driver rows are proved by the compiled query; cache entries are stored
    // only under the same query plus dialect and schema fingerprint. Both establish
    // `Row` at this one boundary, without re-validating cache hits (§3d).
    return value as readonly Row[];
  }

  private async cachedRows(query: CompiledQuery, cache: CacheOptions): Promise<unknown> {
    if (!Number.isFinite(cache.ttlMs) || cache.ttlMs <= 0) {
      throw new RangeError('cache ttlMs must be a positive finite number');
    }

    const store = (this.#cacheStore ??= memoryStore());
    const filters = this.#queryFilters.get(query);
    const key = resultCacheKey({
      dialect: this.dialect,
      schema: this.schema.ir,
      table: this.tableName,
      ...(filters === undefined ? {} : { filters }),
      query,
    });

    try {
      const cached = await store.get(key);
      if (cached !== undefined) return copyCachedRows(cached);
    } catch (error) {
      this.reportCacheFailure(error);
      return this.decodeRows(await this.driver.execute(query));
    }

    const rows = this.decodeRows(await this.driver.execute(query));
    try {
      await store.set(key, copyCachedRows(rows), cache.ttlMs, cacheTags(this.tableName, cache.tags));
    } catch (error) {
      this.reportCacheFailure(error);
    }
    return rows;
  }

  private async invalidateCache(options?: CacheInvalidationOptions): Promise<void> {
    const store = this.#cacheStore;
    if (store === undefined) return;
    try {
      await store.invalidateTags(cacheTags(this.tableName, options?.invalidateTags));
    } catch (error) {
      this.reportCacheFailure(error);
    }
  }

  private reportCacheFailure(error: unknown): void {
    if (this.#cacheFailureReported) return;
    this.#cacheFailureReported = true;
    console.warn('@zmdb/repository cache store failed; continuing on the database path', error);
  }

  /**
   * The db→app crossing on the way out (plan D3).
   *
   * `Entity<T>` says a `timestamp` column is a `Date`, a `bigint` column is a `bigint`, and
   * an extension vector is a number array. A driver may or may not agree: `pg` returns a
   * `Date` for a `timestamptz`, a string for an `int8`, and pgvector's text form when its
   * parser is absent; SQLite returns the `TEXT` it stored. So a raw row can disagree with
   * the declared app type silently unless this boundary converts it.
   *
   * A schema without a `timestamp`, `bigint`, or extension vector skips the walk entirely
   * rather than copying every row to no effect. Only `timestamp` and `bigint` need distinct
   * JSON wire forms; vector decoding is specific to the db→app crossing.
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

  private keyValues(id: PrimaryKeyOf<T>, method: 'findById' | 'update' | 'delete'): readonly unknown[] {
    const keyColumns = this.requiredKeyColumns();

    if (keyColumns.length === 1) {
      const [keyColumn] = keyColumns;
      if (!keyColumn) {
        throw new Error(`schema ${this.tableName} has empty primary key column`);
      }
      if (!isScalarKey(id)) {
        throw new ValidationError(
          `${this.tableName}.${method} requires the value of "${keyColumn}", not ${describeKey(id)}`,
        );
      }
      return [id];
    }

    if (!isRecord(id) || id instanceof Date) {
      throw new ValidationError(
        `${this.tableName}.${method} requires every key column; got ${describeKey(id)}, expected an object with (${keyColumns.join(', ')})`,
      );
    }

    const missing: string[] = [];
    for (const column of keyColumns) {
      if (!Object.hasOwn(id, column) || id[column] === undefined) missing.push(column);
    }
    if (missing.length > 0) throw new IncompleteKeyError(this.tableName, method, missing);
    return keyColumns.map(column => id[column]);
  }

  private keyWhere<B extends WhereTarget>(
    builder: B,
    id: PrimaryKeyOf<T>,
    method: 'findById' | 'update' | 'delete',
  ): B {
    const values = this.keyValues(id, method);
    let keyed = builder;
    for (let index = 0; index < this.keyColumns.length; index++) {
      const column = this.keyColumns[index];
      if (column !== undefined) keyed = keyed.where(column, '=', values[index]);
    }
    return keyed;
  }

  /**
   * SQL Server spells LIMIT through OFFSET/FETCH, which requires ORDER BY.
   * Repository first-row reads own a deterministic order: primary-key order
   * when present, otherwise the declaration's first column.
   */
  private limitOne(builder: SelectBuilder): SelectBuilder {
    if (this.dialect !== 'mssql') return builder.limit(1);

    const fallback = this.schema.ir.columns[0]?.name;
    const order = this.keyColumns.length > 0 ? this.keyColumns : fallback === undefined ? [] : [fallback];
    if (order.length === 0) {
      throw new Error(`schema ${this.tableName} has no column available to order a SQL Server first-row read`);
    }

    let ordered = builder;
    for (const column of order) ordered = ordered.orderBy(column, 'asc');
    return ordered.limit(1);
  }

  /** Validate a typed key and return its values in schema declaration order. */
  private loaderKeyValues(id: PrimaryKeyOf<T>): readonly unknown[] {
    return this.keyValues(id, 'findById');
  }

  [LOADER_ENTITY_KEY](id: PrimaryKeyOf<T>): string {
    return loaderKey(this.loaderKeyValues(id));
  }

  /**
   * Find a primary-key batch through the repository's compiler, decoder and
   * dialect parameter ceiling. Composite tuples use OR-of-AND groups; SQL's
   * AND-before-OR precedence keeps every tuple boundary intact.
   */
  async [LOADER_ENTITY_BATCH](ids: readonly PrimaryKeyOf<T>[]): Promise<readonly (Entity<T> | undefined)[]> {
    const unique = sanitizeKeys(ids);
    if (unique.length === 0) return [];

    const columns = this.requiredKeyColumns();
    const parameterLimit = DIALECT_PARAM_LIMITS[this.dialect];
    const chunkSize = Math.max(1, Math.floor(parameterLimit / columns.length));
    const found = new Map<string, Entity<T>>();
    const filters = this.resolveReadFilters('loader.load', undefined, this.tableName, this.schema, false);

    for (const chunk of chunkArray(unique, chunkSize)) {
      let builder = this.qb.selectFrom(this.tableName);
      if (columns.length === 1) {
        const [column] = columns;
        if (!column) throw new Error(`schema ${this.tableName} has empty primary key column`);
        builder = builder.whereIn(column, chunk);
      } else {
        for (let tupleIndex = 0; tupleIndex < chunk.length; tupleIndex++) {
          const id = chunk[tupleIndex];
          if (id === undefined) continue;
          const values = this.loaderKeyValues(id);
          for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
            const column = columns[columnIndex];
            if (!column) continue;
            const value = values[columnIndex];
            if (tupleIndex === 0 && columnIndex === 0) builder = builder.where(column, '=', value);
            else if (columnIndex === 0) builder = builder.orWhere(column, '=', value);
            else builder = builder.andWhere(column, '=', value);
          }
        }
      }

      const query = this.compileRead('loader.load', undefined, () => builder, { resolvedFilters: filters });
      const rows = await this.rows<EntityRow<T>>(query);
      for (const row of rows) {
        found.set(loaderKey(columns.map(column => row[column])), row);
      }
    }

    return ids.map(id => found.get(this[LOADER_ENTITY_KEY](id)));
  }

  // #218 — typed populate. When `opts.populate` names relations the type declares, the
  // result is widened with those relations *and only those*. Batched IN query per relation;
  // no proxies. Populate keys are `RelationKeys<T>`, so a misspelled relation is a compile
  // error rather than the runtime throw in `resolveRelation`.
  async findById(id: PrimaryKeyOf<T>): Promise<Entity<T> | undefined>;
  async findById<K extends RelationKeys<T> & string>(
    id: PrimaryKeyOf<T>,
    opts: PopulateReadOptions<K>,
  ): Promise<Populated<T, K> | undefined>;
  async findById(id: PrimaryKeyOf<T>, opts: ReadOptions): Promise<Entity<T> | undefined>;
  async findById(id: PrimaryKeyOf<T>, opts?: InternalReadOptions): Promise<Entity<T> | undefined> {
    const populateFilters = this.resolvePopulateFilters(opts?.populate, opts);
    const query = this.compileRead(
      'findById',
      opts,
      () => this.limitOne(this.keyWhere(this.qb.selectFrom(this.tableName), id, 'findById')),
      { additionalKnownNames: this.populateFilterNames(opts?.populate) },
    );
    return this.firstResult(query, opts, populateFilters);
  }

  /** The shared body of `findById` and `findOne`: first row for a where clause, relations attached if asked for. */
  private async firstMatching(where: WhereDTO<T>, options?: InternalReadOptions): Promise<Entity<T> | undefined> {
    const populateFilters = this.resolvePopulateFilters(options?.populate, options);
    const query = this.compileRead(
      'findOne',
      options,
      () => this.limitOne(compileWhere(this.qb.selectFrom(this.tableName), where)),
      { additionalKnownNames: this.populateFilterNames(options?.populate) },
    );
    return this.firstResult(query, options, populateFilters);
  }

  private async firstResult(
    query: CompiledQuery,
    options?: InternalReadOptions,
    populateFilters: ReadonlyMap<string, ResolvedFilters> = new Map(),
  ): Promise<Entity<T> | undefined> {
    const rows = await this.rows<EntityRow<T>>(query, options?.cache);
    const row = rows[0];
    if (!row || !options?.populate?.length) return row;
    const [populated] = await this.attachRelations([row], options.populate, options, populateFilters);
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
    options?: ReadOptions,
    filters?: ResolvedFilters,
  ): Promise<Map<unknown, Record<string, unknown>[]>> {
    const ids = sanitizeKeys(parentIds);
    if (ids.length === 0) return new Map();
    // DIALECT_PARAM_LIMITS provides a conservative list-length heuristic threshold leaving parameter headroom below driver variable limits.
    const limit = DIALECT_PARAM_LIMITS[this.dialect];
    const chunks = chunkArray(ids, limit);
    const children: Record<string, unknown>[] = [];
    for (const chunk of chunks) {
      const query = this.compileRead(
        'populate',
        options,
        () => this.qb.selectFrom(childTable).whereIn(childFk, chunk),
        {
          table: childTable,
          qualifyColumns: true,
          ...(filters === undefined ? {} : { resolvedFilters: filters }),
        },
      );
      const res = await this.driver.execute(query);
      children.push(...res);
    }
    const byParent = new Map<unknown, Record<string, unknown>[]>();
    for (const c of children) {
      const key = c[childFk];
      const list = byParent.get(key) ?? [];
      list.push(c);
      byParent.set(key, list);
    }
    return byParent;
  }

  /** Batch-load and attach named relations to parent rows without mutating inputs. */
  private attachRelations<K extends RelationKeys<T> & string>(
    parents: readonly Entity<T>[],
    names: readonly K[],
    options?: ReadOptions,
    populateFilters?: ReadonlyMap<string, ResolvedFilters>,
  ): Promise<readonly Populated<T, K>[]>;
  private attachRelations<Row extends object>(
    parents: readonly Row[],
    names: readonly string[],
    options?: ReadOptions,
    populateFilters?: ReadonlyMap<string, ResolvedFilters>,
  ): Promise<readonly Row[]>;
  private async attachRelations(
    parents: readonly object[],
    names: readonly string[],
    options?: ReadOptions,
    populateFilters: ReadonlyMap<string, ResolvedFilters> = this.resolvePopulateFilters(names, options),
  ): Promise<readonly object[]> {
    if (parents.length === 0) return parents;
    let current: object[] = parents.map(parent => ({ ...parent }));

    for (const name of names) {
      const rel = this.relation(name);
      const byParent = await this.childrenByParent(
        rel.targetTable,
        rel.targetKey,
        current.map(parent => Reflect.get(parent, rel.parentKey)),
        options,
        populateFilters.get(name),
      );
      current = current.map(parent => {
        const parentKey = Reflect.get(parent, rel.parentKey);
        if (parentKey === null || parentKey === undefined) {
          return { ...parent, [name]: rel.toMany ? [] : null };
        }
        const list = byParent.get(parentKey) ?? [];
        if (rel.toMany) {
          return { ...parent, [name]: list.map(child => ({ ...child })) };
        }
        const first = list[0];
        return { ...parent, [name]: first ? { ...first } : null };
      });
    }

    return current;
  }

  [LOADER_RELATION_KEY]<K extends RelationKeys<T> & string>(parent: Entity<T>, relation: K): string {
    const resolved = this.relation(relation);
    return loaderKey([Reflect.get(parent, resolved.parentKey)]);
  }

  async [LOADER_RELATION_BATCH]<K extends RelationKeys<T> & string>(
    parents: readonly Entity<T>[],
    relation: K,
  ): Promise<readonly RelationValueOf<T, K>[]> {
    const filters = this.resolvePopulateFilters([relation], undefined);
    const populated = await this.attachRelations(parents, [relation], undefined, filters);
    return populated.map(parent => parent[relation]);
  }

  async findOne<K extends RelationKeys<T> & string>(
    where: WhereDTO<T>,
    opts: PopulateReadOptions<K>,
  ): Promise<Populated<T, K> | undefined>;
  async findOne(where: WhereDTO<T>): Promise<Entity<T> | undefined>;
  async findOne(where: WhereDTO<T>, opts: ReadOptions): Promise<Entity<T> | undefined>;
  async findOne(where: WhereDTO<T>, opts?: InternalReadOptions): Promise<Entity<T> | undefined> {
    return this.firstMatching(where, opts);
  }

  async find(where: WhereDTO<T>): Promise<readonly Entity<T>[]>;
  async find<K extends RelationKeys<T> & string>(
    where: WhereDTO<T>,
    opts: PopulateReadOptions<K>,
  ): Promise<readonly Populated<T, K>[]>;
  async find(where: WhereDTO<T>, opts: ReadOptions): Promise<readonly Entity<T>[]>;
  async find(where: WhereDTO<T>, opts?: InternalReadOptions): Promise<readonly Entity<T>[]> {
    const populateFilters = this.resolvePopulateFilters(opts?.populate, opts);
    const query = this.compileRead('find', opts, () => compileWhere(this.qb.selectFrom(this.tableName), where), {
      additionalKnownNames: this.populateFilterNames(opts?.populate),
    });
    const rows = await this.rows<EntityRow<T>>(query, opts?.cache);
    if (!opts?.populate?.length) return rows;
    return this.attachRelations(rows, opts.populate, opts, populateFilters);
  }

  async findAll<K extends RelationKeys<T> & string>(opts: PopulateReadOptions<K>): Promise<readonly Populated<T, K>[]>;
  async findAll(): Promise<readonly Entity<T>[]>;
  async findAll(opts: ReadOptions): Promise<readonly Entity<T>[]>;
  async findAll(opts?: InternalReadOptions): Promise<readonly Entity<T>[]> {
    const populateFilters = this.resolvePopulateFilters(opts?.populate, opts);
    const query = this.compileRead('findAll', opts, () => this.qb.selectFrom(this.tableName), {
      additionalKnownNames: this.populateFilterNames(opts?.populate),
    });
    const rows = await this.rows<EntityRow<T>>(query, opts?.cache);
    if (!opts?.populate?.length) return rows;
    return this.attachRelations(rows, opts.populate, opts, populateFilters);
  }

  async count(where?: WhereDTO<T>, options?: ReadOptions): Promise<number> {
    const query = this.compileRead('count', options, () => {
      let builder = aggregateSelectFrom(
        this.tableName,
        this.dialect,
        this.driver.queryTelemetry === true ? { telemetry: true } : undefined,
      ).count('*', 'count');
      if (where !== undefined) builder = compileWhere(builder, where);
      return builder;
    });
    const rows = await this.driver.execute(query);
    const value = rows[0]?.['count'];
    if (value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'bigint' || typeof value === 'string') {
      const count = Number(value);
      if (Number.isSafeInteger(count)) return count;
    }
    throw new ValidationError(`count for \`${this.tableName}\` was not a safe integer`);
  }

  async exists(where?: WhereDTO<T>, options?: ReadOptions): Promise<boolean> {
    const firstColumn = this.keyColumns[0] ?? this.schema.ir.columns[0]?.name;
    if (firstColumn === undefined) throw new Error(`schema ${this.tableName} has no column to test for existence`);
    const query = this.compileRead('exists', options, () => {
      let builder = this.qb.selectFrom(this.tableName).select([firstColumn]);
      if (where !== undefined) builder = compileWhere(builder, where);
      return this.limitOne(builder);
    });
    return (await this.driver.execute(query)).length > 0;
  }

  async list<K extends RelationKeys<T> & string>(
    query: ListDTO<T> | undefined,
    opts: PopulateReadOptions<K>,
  ): Promise<ListResult<Populated<T, K>>>;
  async list(query?: ListDTO<T>): Promise<ListResult<Entity<T>>>;
  async list(query: ListDTO<T> | undefined, opts: ReadOptions): Promise<ListResult<Entity<T>>>;
  async list(query?: ListDTO<T>, opts?: InternalReadOptions): Promise<ListResult<Entity<T>>> {
    const populateFilters = this.resolvePopulateFilters(opts?.populate, opts);
    const keyColumns = this.requiredKeyColumns();

    const userOrderBy = query?.orderBy;
    const effectiveOrderBy: Array<OrderBySpec[number]> = userOrderBy ? [...userOrderBy] : [];
    for (const column of keyColumns) {
      if (!effectiveOrderBy.some(item => String(item.column) === column)) {
        effectiveOrderBy.push({ column, dir: 'asc' });
      }
    }

    const page = query?.page;
    const limit = page && 'limit' in page ? page.limit : undefined;
    const keyset = page && 'after' in page && page.after !== undefined && page.after !== null;
    let cursorValues: Record<string, unknown> | undefined;
    if (keyset) {
      if (typeof page.after === 'string') {
        cursorValues = decodeCursor(page.after);
      } else if (typeof page.after === 'object' && !Array.isArray(page.after)) {
        // boundary: page.after is an untrusted client DTO parameter; runtime check above proves it is a non-null, non-array object.
        cursorValues = page.after as Record<string, unknown>;
      } else {
        throw new Error('Invalid cursor parameter: expected string or object');
      }
    }

    const compiled = this.compileRead(
      'list',
      opts,
      filters => {
        let builder = applyOrderBy(this.qb.selectFrom(this.tableName), effectiveOrderBy);
        if (keyset && cursorValues !== undefined) {
          builder = applyKeysetFilter(builder, cursorValues, effectiveOrderBy, query?.where, branch => {
            applyResolvedFilters(branch, filters);
          });
          if (limit !== undefined) builder = builder.limit(limit + 1);
          return builder;
        }
        if (query?.where) builder = compileWhere(builder, query.where);
        if (page) {
          builder = applyPagination(builder, {
            limit: limit !== undefined ? limit + 1 : page.limit,
            offset: 'offset' in page ? page.offset : undefined,
          });
        }
        return builder;
      },
      {
        filtersApplied: keyset === true,
        additionalKnownNames: this.populateFilterNames(opts?.populate),
      },
    );

    const rows = await this.rows<EntityRow<T>>(compiled, opts?.cache);
    const listOpts = {
      ...(limit !== undefined ? { limit } : {}),
      ...(query?.select ? { select: query.select } : {}),
      orderBy: effectiveOrderBy,
    };
    const res = buildListResult(rows, listOpts);
    if (opts?.populate?.length) {
      const populatedItems = await this.attachRelations(res.items, opts.populate, opts, populateFilters);
      return { ...res, items: populatedItems };
    }
    return res;
  }

  // #96 — full-text search integration. Uses the query-compiler FTS builder.
  // SQLite compiles FTS5 virtual table JOINs when ftsTable is declared on the
  // schema; querying plain SQLite columns without a declared virtual table
  // throws UnsupportedFeatureError (never a silently-wrong query).
  async findByFullText(
    column: string,
    term: string,
    options?: ReadOptions,
  ): Promise<readonly Record<string, unknown>[]> {
    const ftsTable = this.schema.ftsTable;
    const query = this.compileRead('findByFullText', options, () =>
      ftsSelectFrom(
        this.tableName,
        this.dialect,
        this.driver.queryTelemetry === true ? { ftsTable, telemetry: true } : { ftsTable },
      ).whereMatch(column, term),
    );
    return this.driver.execute(query);
  }

  // #87 — JOIN integration. Fetch this table left-joined to a target on an FK,
  // filtered by a predicate on the base table. Returns flat joined rows (plain
  // objects — no proxies). Uses the query-compiler JOIN builder.
  async findJoined<Target extends DeclaredTable, Kind extends 'inner' | 'left' = 'left'>(
    join: { target: TaggedSchema<Target>; leftCol: string; rightCol: string; kind?: Kind },
    where?: { col: string; op: string; value: unknown },
    options?: ReadOptions,
  ): Promise<readonly JoinRow<Entity<T>, Entity<Target>, Kind>[]>;
  async findJoined<Joined = Record<string, unknown>, Kind extends 'inner' | 'left' = 'left'>(
    join: { target: string; leftCol: string; rightCol: string; kind?: Kind },
    where?: { col: string; op: string; value: unknown },
    options?: ReadOptions,
  ): Promise<readonly JoinRow<Entity<T>, Joined, Kind>[]>;
  async findJoined(
    join: { target: string | CoreSchema<string>; leftCol: string; rightCol: string; kind?: 'inner' | 'left' },
    where?: { col: string; op: string; value: unknown },
    options?: ReadOptions,
  ): Promise<readonly Record<string, unknown>[]> {
    const targetTable = typeof join.target === 'string' ? join.target : join.target.table;
    const targetSpec = parseTableSpec(targetTable);
    const targetSchema = typeof join.target === 'string' ? undefined : join.target;
    const targetDefinitions = this.filterDefinitionsFor(targetSpec.table, targetSchema);
    const targetFilters = this.resolveReadFilters(
      'findJoined',
      options,
      targetSpec.table,
      targetSchema,
      true,
      this.rootFilterNames(),
      targetSpec.reference,
    );
    const query = this.compileRead(
      'findJoined',
      options,
      () => {
        let builder = joinableSelectFrom(
          this.tableName,
          this.dialect,
          this.driver.queryTelemetry === true ? { telemetry: true } : undefined,
        );
        builder = (join.kind === 'inner' ? builder.innerJoin : builder.leftJoin).call(
          builder,
          targetTable,
          join.leftCol,
          join.rightCol,
          filtersAsPredicates(targetFilters),
        );
        if (where) builder = builder.where(where.col, where.op, where.value);
        return builder;
      },
      {
        additionalFilterNames: targetFilters.names,
        additionalKnownNames: targetDefinitions.map(filter => filter.name),
      },
    );
    return this.driver.execute(query);
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
    filterTable: string;
    targetReference: string;
    leftCol: string;
    rightCol: string;
  } {
    const rel = this.relation(relationName);
    const alias = relationName.trim();
    const targetTable =
      rel.targetTable.toLowerCase() === alias.toLowerCase() ? rel.targetTable : `${rel.targetTable} as ${alias}`;
    return {
      targetTable,
      filterTable: rel.targetTable,
      targetReference: alias,
      leftCol: `${this.tableName}.${rel.parentKey}`,
      rightCol: `${alias}.${rel.targetKey}`,
    };
  }

  private filteredRelationJoin(relationName: string, options?: ReadOptions) {
    const join = this.resolveRelationJoin(relationName);
    const definitions = this.filterDefinitionsFor(join.filterTable);
    const filters = this.resolveReadFilters(
      'aggregate',
      options,
      join.filterTable,
      undefined,
      true,
      this.allDeclaredFilterNames(),
      join.targetReference,
    );
    return { ...join, filters, knownNames: definitions.map(filter => filter.name) };
  }

  private createRepositoryAggregateBuilder(
    options: ReadOptions | undefined,
    targetFilterNames: Set<string>,
    targetKnownNames: Set<string>,
  ): RepositoryAggregateBuilder {
    let builder = aggregateSelectFrom(
      this.tableName,
      this.dialect,
      this.driver.queryTelemetry === true ? { telemetry: true } : undefined,
    );
    const resolveRelationJoin = (relationName: string) => this.filteredRelationJoin(relationName, options);
    const resolveTableJoin = (targetTable: string) => {
      const target = parseTableSpec(targetTable);
      const definitions = this.filterDefinitionsFor(target.table);
      const filters = this.resolveReadFilters(
        'aggregate',
        options,
        target.table,
        undefined,
        true,
        this.allDeclaredFilterNames(),
        target.reference,
      );
      return { filters, knownNames: definitions.map(filter => filter.name) };
    };

    const wrap = (b: AggregateSelect): RepositoryAggregateBuilder => {
      builder = b;
      const target: RepositoryAggregateBuilder = Object.assign(builder, {
        joinRelation(relationName: string, kind: 'inner' | 'left' | 'right' = 'inner'): RepositoryAggregateBuilder {
          const { targetTable, leftCol, rightCol, filters, knownNames } = resolveRelationJoin(relationName);
          for (const name of filters.names) targetFilterNames.add(name);
          for (const name of knownNames) targetKnownNames.add(name);
          let nextB = builder;
          const predicates = filtersAsPredicates(filters);
          if (kind === 'left') nextB = builder.leftJoin(targetTable, leftCol, rightCol, predicates);
          else if (kind === 'right') nextB = builder.rightJoin(targetTable, leftCol, rightCol, predicates);
          else nextB = builder.innerJoin(targetTable, leftCol, rightCol, predicates);
          return wrap(nextB);
        },
      });

      return new Proxy<RepositoryAggregateBuilder>(target, {
        get(t, prop, receiver) {
          if (prop === 'joinRelation') {
            return t.joinRelation;
          }
          if (prop === 'innerJoin' || prop === 'leftJoin' || prop === 'rightJoin') {
            return (
              targetTable: string,
              leftCol: string,
              rightCol: string,
              on?: readonly Predicate[],
            ): RepositoryAggregateBuilder => {
              const { filters, knownNames } = resolveTableJoin(targetTable);
              for (const name of filters.names) targetFilterNames.add(name);
              for (const name of knownNames) targetKnownNames.add(name);
              const predicates = [...(on ?? []), ...filtersAsPredicates(filters)];
              const joined =
                prop === 'leftJoin'
                  ? builder.leftJoin(targetTable, leftCol, rightCol, predicates)
                  : prop === 'rightJoin'
                    ? builder.rightJoin(targetTable, leftCol, rightCol, predicates)
                    : builder.innerJoin(targetTable, leftCol, rightCol, predicates);
              return wrap(joined);
            };
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
    specOrBuild: AggregateSpec<T> | ((agg: RepositoryAggregateBuilder) => AggregateSelect | void),
    options?: ReadOptions,
  ): Promise<readonly Out[]> {
    let q: CompiledQuery;
    const targetFilterNames = new Set<string>();
    const targetKnownNames = new Set<string>();

    if (typeof specOrBuild === 'function') {
      const builder = this.createRepositoryAggregateBuilder(options, targetFilterNames, targetKnownNames);
      const res = specOrBuild(builder);
      q = this.compileRead('aggregate', options, () => res ?? builder, {
        additionalFilterNames: [...targetFilterNames],
        additionalKnownNames: [...targetKnownNames],
      });
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
        const { targetTable, leftCol, rightCol, filters, knownNames } = this.filteredRelationJoin(relName, options);
        for (const name of filters.names) targetFilterNames.add(name);
        for (const name of knownNames) targetKnownNames.add(name);
        const predicates = filtersAsPredicates(filters);
        if (kind === 'left') builder = builder.leftJoin(targetTable, leftCol, rightCol, predicates);
        else if (kind === 'right') builder = builder.rightJoin(targetTable, leftCol, rightCol, predicates);
        else builder = builder.innerJoin(targetTable, leftCol, rightCol, predicates);
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

      q = this.compileRead('aggregate', options, () => builder, {
        additionalFilterNames: [...targetFilterNames],
        additionalKnownNames: [...targetKnownNames],
      });
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
    // walk it looking for this table's `timestamp`, `bigint`, and extension vector columns,
    // and `COUNT(*)` is not one of them.
    return mappedRows as readonly Out[];
  }

  // #34 — explicit populate for a to-many relation. Loads parents, then batches
  // one IN() query for children, and attaches them under `relationName`. No
  // proxies, no identity map — children are plain rows on plain parents.
  async findAllWithMany<K extends RelationKeys<T> & string>(
    relationName: K,
    options?: ReadOptions,
  ): Promise<readonly Populated<T, K>[]>;
  async findAllWithMany(
    relationName: string,
    childTable: string,
    childFk: string,
    parentKey?: string,
    options?: ReadOptions,
  ): Promise<readonly Record<string, unknown>[]>;
  async findAllWithMany(
    relationName: string,
    childTableOrOptions?: string | ReadOptions,
    childFk?: string,
    parentKey = 'id',
    explicitOptions?: ReadOptions,
  ): Promise<readonly Record<string, unknown>[]> {
    const childTable = typeof childTableOrOptions === 'string' ? childTableOrOptions : undefined;
    const options = typeof childTableOrOptions === 'string' ? explicitOptions : childTableOrOptions;
    const knownNames =
      childTable === undefined
        ? this.populateFilterNames([relationName])
        : [
            ...new Set([
              ...this.rootFilterNames(),
              ...this.filterDefinitionsFor(childTable).map(filter => filter.name),
            ]),
          ];
    const relationFilters =
      !childTable || !childFk
        ? this.resolvePopulateFilters([relationName], options)
        : new Map([
            [relationName, this.resolveReadFilters('populate', options, childTable, undefined, true, knownNames)],
          ]);
    const parentQuery = this.compileRead('findAllWithMany', options, () => this.qb.selectFrom(this.tableName), {
      additionalKnownNames: knownNames,
    });
    const fetched = await this.rows<EntityRow<T>>(parentQuery, options?.cache);
    if (fetched.length === 0) return fetched;
    // Without an explicit child table/FK the relation has to be looked up, which
    // is what attachRelations does; with one, the caller has already told us
    // everything the batched fetch needs.
    if (!childTable || !childFk) return this.attachRelations(fetched, [relationName], options, relationFilters);
    const byParent = await this.childrenByParent(
      childTable,
      childFk,
      fetched.map(p => p[parentKey]),
      options,
      relationFilters.get(relationName),
    );
    return fetched.map(p => ({
      ...p,
      [relationName]: byParent.get(p[parentKey]) ?? [],
    }));
  }

  // #207 — typed writes. Create keeps the derived CreateDTO; update accepts the
  // expression-aware UpdatePatch and validates its plain values and operands
  // separately before SQL.
  async create(dto: CreateDTO<T>, options?: CacheInvalidationOptions): Promise<Entity<T>> {
    const clean = this.validatePayload(dto, 'create');
    this.preInsert(clean);
    const rows = await this.rows<EntityRow<T>>(
      this.qb.insertInto(this.tableName).values(clean).returning(['*']).compile(),
    );
    await this.invalidateCache(options);
    const row = rows[0];
    if (!row) throw new Error(`insert into ${this.tableName} returned no row`);
    this.postInsert(row);
    return row;
  }

  async upsert(dto: CreateDTO<T>, opts?: UpsertOptions<T>): Promise<Entity<T> | undefined> {
    const clean = this.validatePayload(dto, 'create');
    this.preInsert(clean);
    const target = opts?.target ?? this.requiredKeyColumns();
    const requestedUpdateFields = opts?.updateFields;
    const updateFields =
      requestedUpdateFields !== undefined && !Array.isArray(requestedUpdateFields)
        ? this.validateUpdatePatch(requestedUpdateFields)
        : requestedUpdateFields;
    const ib = this.qb.insertInto(this.tableName).values(clean).onConflict(target).doUpdate(updateFields);
    if (
      this.dialect === 'mysql' &&
      updateFields !== undefined &&
      !Array.isArray(updateFields) &&
      this.hasColumnExpression(updateFields)
    ) {
      await this.driver.execute(ib.compile());
      await this.invalidateCache(opts);
      return undefined;
    }
    const rows = await this.rows<EntityRow<T>>(ib.returning(['*']).compile());
    await this.invalidateCache(opts);
    const row = rows[0];
    if (!row) {
      return undefined;
    }
    this.postInsert(row);
    return row;
  }

  async update(
    id: PrimaryKeyOf<T>,
    patch: UpdatePatch<T>,
    options?: CacheInvalidationOptions,
  ): Promise<Entity<T> | undefined> {
    return this.updateOne(id, patch, options);
  }

  async updateMany(
    where: WhereDTO<T>,
    patch: UpdatePatch<T>,
    options?: CacheInvalidationOptions,
  ): Promise<number | undefined> {
    const clean = this.validateUpdatePatch(patch);
    this.preUpdate(clean);
    if (Object.keys(clean).length === 0) return 0;
    const builder = compileWhere(this.qb.updateTable(this.tableName).set(clean), where);
    if (this.dialect === 'mysql') {
      await this.driver.execute(builder.compile());
      await this.invalidateCache(options);
      return undefined;
    }
    const returning = this.schema.primaryKey.length > 0 ? this.schema.primaryKey : ['*'];
    const updated = (await this.driver.execute(builder.returning(returning).compile())).length;
    await this.invalidateCache(options);
    return updated;
  }

  async increment<K extends NumericColumnOf<T>>(
    id: PrimaryKeyOf<T>,
    column: K,
    by?: NumericOperandOf<T, K>,
    options?: CacheInvalidationOptions,
  ): Promise<Entity<T> | undefined>;
  async increment(
    id: PrimaryKeyOf<T>,
    column: string,
    by?: number | bigint,
    options?: CacheInvalidationOptions,
  ): Promise<Entity<T> | undefined> {
    const irColumn = this.payloadShape('update').columns.get(column);
    if (
      irColumn === undefined ||
      irColumn.payload !== undefined ||
      (irColumn.sql !== 'integer' && irColumn.sql !== 'bigint' && irColumn.sql !== 'numeric')
    ) {
      throw new ValidationError(`"${column}" is not an updatable numeric column of "${this.tableName}"`, [
        {
          path: `input.${column}`,
          message: 'expected an updatable numeric column',
          expected: 'integer, bigint, or numeric column',
          value: column,
        },
      ]);
    }
    const operand = by ?? (irColumn.sql === 'bigint' ? 1n : 1);
    return this.updateOne(id, { [column]: inc(operand) }, options);
  }

  private async updateOne(
    id: PrimaryKeyOf<T>,
    patch: unknown,
    options?: CacheInvalidationOptions,
  ): Promise<Entity<T> | undefined> {
    const clean = this.validateUpdatePatch(patch);
    this.preUpdate(clean);
    // Built before the empty-patch shortcut so that a bad key is reported as `update` rather
    // than as the `findById` it would otherwise delegate to (§2.1: "the method in the message
    // is the method the caller actually called").
    if (Object.keys(clean).length === 0) {
      const query = this.limitOne(this.keyWhere(this.qb.selectFrom(this.tableName), id, 'update')).compile();
      return this.firstResult(query);
    }
    const builder = this.keyWhere(this.qb.updateTable(this.tableName).set(clean), id, 'update');
    if (this.dialect === 'mysql' && this.hasColumnExpression(clean)) {
      await this.driver.execute(this.assertKeyed(builder.compile(), 'update'));
      await this.invalidateCache(options);
      return undefined;
    }
    const rows = await this.rows<EntityRow<T>>(this.assertKeyed(builder.returning(['*']).compile(), 'update'));
    await this.invalidateCache(options);
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
  async delete(id: PrimaryKeyOf<T>, options?: CacheInvalidationOptions): Promise<boolean> {
    this.preDelete(id);
    const builder = this.keyWhere(this.qb.deleteFrom(this.tableName), id, 'delete');
    const query = this.dialect === 'mysql' ? builder.compile() : builder.returning(this.keyColumns).compile();
    const rows = await this.driver.execute(this.assertKeyed(query, 'delete'));
    await this.invalidateCache(options);
    if (this.dialect === 'mysql') {
      const affectedRows = rows[0]?.['affectedRows'];
      if (typeof affectedRows === 'number') return affectedRows > 0;
    }
    return rows.length > 0;
  }

  // Explicit, synchronous lifecycle hooks. No hidden change tracking — these
  // fire only around the corresponding operation, in documented order.
  protected preInsert(_row: Record<string, unknown>): void {}
  protected postInsert(_row: Record<string, unknown>): void {}
  protected preUpdate(_patch: Record<string, unknown>): void {}
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
      columns: new Map(shape.map(({ column }) => [column.name, column])),
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

  /**
   * Validate a patch without teaching the DTO validator that arbitrary objects are
   * column values. Plain values still cross the unchanged UpdateDTO object check;
   * branded expressions are omitted from that object and their one operand is
   * checked against the same column IR separately.
   */
  private validateUpdatePatch(payload: unknown): Record<string, unknown> {
    if (!isRecord(payload)) {
      throw new ValidationError('payload must be an object', [
        { path: 'input', message: 'expected object', expected: 'object', value: payload },
      ]);
    }

    const obj = this.sanitizePayload(payload);
    const values: Record<string, unknown> = {};
    const expressionIssues: ValidationIssue[] = [];
    const { shape, type, columns } = this.payloadShape('update');

    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (!isColumnExpression(value)) {
        values[key] = value;
        continue;
      }

      const column = columns.get(key);
      if (column === undefined) continue;
      const operand = expressionOperand(value);
      if (operand !== NO_EXPRESSION_OPERAND) {
        expressionIssues.push(...issuesFor(operand, appTypeOf(column), `input.${key}`));
      }
    }

    const issues = [...issuesFor(values, type), ...expressionIssues, ...this.excessIssues(obj, 'update')];
    if (issues.length > 0) {
      throw new ValidationError(`validation failed: ${issues.map(issue => issue.path).join(', ')}`, issues);
    }

    const out: Record<string, unknown> = {};
    for (const { column } of shape) {
      if (column.name in obj) out[column.name] = obj[column.name];
    }
    return out;
  }

  private hasColumnExpression(patch: Record<string, unknown>): boolean {
    return Object.values(patch).some(isColumnExpression);
  }
}

// #223 — wiring helper. Bind a schema to a driver and get a fully typed repository
// instance without writing a subclass. There used to be a `relations` option here; the
// relations are on `T`, which `schema` carries, so passing them again was the second
// spelling this design exists to remove.
export interface DefineRepositoryOptions extends RepositoryOptions {
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
  return new Repo(driver, opts?.dialect ?? 'postgres', opts);
}

export { memoryStore, type CacheInvalidationOptions, type CacheOptions, type CacheStore } from './cache/index.js';
export type { FilterDef, FilterOverride, FilterOverrides, FilterParams, FilterPredicate } from './filters/index.js';
export {
  createLoaderScope,
  type EntityLoader,
  type LoaderScope,
  type RelationLoader,
  type RelationValueOf,
} from './loaders/index.js';
export * from './transactions/index.js';
