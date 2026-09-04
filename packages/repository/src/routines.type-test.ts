import type { CompiledQuery, QueryCompiler } from '@zmdb/query-compiler';
// @ts-expect-error frozen (schema-objects/SPEC.md 8): RoutineDef is not exported yet.
import type { RoutineDef } from '@zmdb/query-compiler/schema-objects';
// Compile-time tests freeze for #437. `@ts-expect-error` is the type-level
// equivalent of `it.fails`: each directive absorbs one current missing-surface
// error and becomes TS2578 when the implementation lands without retiring it.
// The local frozen forms separately prove wrong arity and wrong argument type
// without using a `declare const` test vehicle.
import type { Equal, Expect, SqlType } from '@zmdb/schema-core';
import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';

// @ts-expect-error frozen (repository/SPEC.md 4a): ArgsOf and ResultOf are not exported yet.
import { BaseRepository, type ArgsOf, type ResultOf } from './index.js';

interface FrozenRoutineDef {
  readonly kind: 'function' | 'procedure';
  readonly name: string;
  readonly params: readonly {
    readonly name: string;
    readonly type: SqlType;
    readonly mode?: 'in' | 'out' | 'inout';
  }[];
  readonly returns?: { readonly type: SqlType | 'void'; readonly setof?: boolean };
  readonly language?: string;
  readonly deterministic?: boolean;
  readonly body: string;
}

type FrozenCompileRoutine = (name: string, args: readonly unknown[]) => CompiledQuery;

// The accepted correction keeps all three calls on the existing
// dialect-bound compiler. Each property access is an error today and retires
// when the implementation adds the method with the exact non-generic shape.
// @ts-expect-error frozen (repository/SPEC.md 4a): QueryCompiler has no callFunction yet.
export type _FunctionCompiler = Expect<Equal<QueryCompiler['callFunction'], FrozenCompileRoutine>>;

// @ts-expect-error frozen (repository/SPEC.md 4a): QueryCompiler has no callTableFunction yet.
export type _TableFunctionCompiler = Expect<Equal<QueryCompiler['callTableFunction'], FrozenCompileRoutine>>;

// @ts-expect-error frozen (repository/SPEC.md 4a): QueryCompiler has no callProcedure yet.
export type _ProcedureCompiler = Expect<Equal<QueryCompiler['callProcedure'], FrozenCompileRoutine>>;

type AppType<T extends SqlType | 'void'> = T extends 'serial' | 'integer' | 'numeric'
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

type AppTypeOfParam<P> = P extends { readonly type: infer T extends SqlType } ? AppType<T> : never;

type ArgsFromParams<P extends readonly FrozenRoutineDef['params'][number][]> = P extends readonly []
  ? readonly []
  : P extends readonly [infer Head, ...infer Tail extends readonly FrozenRoutineDef['params'][number][]]
    ? readonly [AppTypeOfParam<Head>, ...ArgsFromParams<Tail>]
    : readonly AppTypeOfParam<P[number]>[];

type FrozenArgsOf<D extends FrozenRoutineDef> = ArgsFromParams<D['params']>;

type FrozenResultOf<D extends FrozenRoutineDef> = D['kind'] extends 'procedure'
  ? void
  : D['returns'] extends {
        readonly type: infer T extends SqlType | 'void';
        readonly setof: true;
      }
    ? readonly AppType<T>[]
    : D['returns'] extends { readonly type: infer T extends SqlType | 'void' }
      ? AppType<T>
      : void;

const archive = {
  kind: 'function',
  name: 'archive_old_orders',
  params: [
    { name: 'cutoff', type: 'timestamp' },
    { name: 'tenant_id', type: 'bigint' },
  ],
  returns: { type: 'integer' },
  language: 'plpgsql',
  body: 'BEGIN RETURN 1; END;',
} as const satisfies FrozenRoutineDef;

const activeIds = {
  kind: 'function',
  name: 'active_user_ids',
  params: [{ name: 'org_id', type: 'bigint' }],
  returns: { type: 'bigint', setof: true },
  language: 'sql',
  body: 'SELECT id FROM users WHERE org_id = org_id;',
} as const satisfies FrozenRoutineDef;

const rebuild = {
  kind: 'procedure',
  name: 'rebuild_search_index',
  params: [],
  body: 'BEGIN END;',
} as const satisfies FrozenRoutineDef;

function frozenCall<D extends FrozenRoutineDef>(_definition: D, _args: FrozenArgsOf<D>): FrozenResultOf<D> {
  throw new Error('type-only test vehicle');
}

frozenCall(archive, [new Date(), 7n]);

// @ts-expect-error frozen: the declaration has two input parameters.
frozenCall(archive, [new Date()]);

// @ts-expect-error frozen: bigint routine parameters take bigint, not number.
frozenCall(archive, [new Date(), 7]);

// @ts-expect-error frozen: timestamp routine parameters take Date, not their wire string.
frozenCall(archive, ['2026-01-01T00:00:00.000Z', 7n]);

type _FrozenScalarResult = Expect<Equal<FrozenResultOf<typeof archive>, number>>;
type _FrozenSetResult = Expect<Equal<FrozenResultOf<typeof activeIds>, readonly bigint[]>>;
type _FrozenProcedureResult = Expect<Equal<FrozenResultOf<typeof rebuild>, void>>;

// The imported types are error types today, so these comparisons are false and
// each directive is live. They retire only when the exported implementation
// matches the frozen declaration-derived shapes.
// @ts-expect-error frozen: the exported RoutineDef does not exist yet.
export type _RoutineDefShape = Expect<Equal<RoutineDef, FrozenRoutineDef>>;

// @ts-expect-error frozen: ArgsOf does not exist yet.
export type _ArgsFromDeclaration = Expect<Equal<ArgsOf<typeof archive>, readonly [Date, bigint]>>;

// @ts-expect-error frozen: ResultOf does not exist yet.
export type _ScalarResultFromDeclaration = Expect<Equal<ResultOf<typeof archive>, number>>;

// @ts-expect-error frozen: setof maps to readonly rows.
export type _SetResultFromDeclaration = Expect<Equal<ResultOf<typeof activeIds>, readonly bigint[]>>;

// @ts-expect-error frozen: procedures resolve void.
export type _ProcedureResultFromDeclaration = Expect<Equal<ResultOf<typeof rebuild>, void>>;

interface RoutineHost extends Table<'routine_host'> {
  id: number & Sql<'integer'> & PrimaryKey;
}

abstract class FrozenRepositorySurface extends BaseRepository<RoutineHost> {
  invoke<D extends RoutineDef>(definition: D, args: ArgsOf<D>): Promise<ResultOf<D>> {
    // @ts-expect-error frozen: BaseRepository has no protected call(def, args) yet.
    return this.call(definition, args);
  }
}

void FrozenRepositorySurface;
