import type { CompiledQuery, QueryCompiler } from '@zmdb/query-compiler';
import type { RoutineDef } from '@zmdb/query-compiler/schema-objects';
// Compile-time contract frozen for #437 and implemented by #439. The local
// frozen forms keep the exact expected shapes visible, while the repository
// subclass at the bottom drives the real protected call surface.
import type { Equal, Expect, SqlType } from '@zmdb/schema-core';
import type { PrimaryKey, Sql, Table } from '@zmdb/schema-core/tags';

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
// dialect-bound compiler, with an exact non-generic shape.
export type _FunctionCompiler = Expect<Equal<QueryCompiler['callFunction'], FrozenCompileRoutine>>;

export type _TableFunctionCompiler = Expect<Equal<QueryCompiler['callTableFunction'], FrozenCompileRoutine>>;

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

export type _RoutineDefShape = Expect<Equal<RoutineDef, FrozenRoutineDef>>;

export type _ArgsFromDeclaration = Expect<Equal<ArgsOf<typeof archive>, readonly [Date, bigint]>>;

export type _ScalarResultFromDeclaration = Expect<Equal<ResultOf<typeof archive>, number>>;

export type _SetResultFromDeclaration = Expect<Equal<ResultOf<typeof activeIds>, readonly bigint[]>>;

export type _ProcedureResultFromDeclaration = Expect<Equal<ResultOf<typeof rebuild>, void>>;

interface RoutineHost extends Table<'routine_host'> {
  id: number & Sql<'integer'> & PrimaryKey;
}

abstract class FrozenRepositorySurface extends BaseRepository<RoutineHost> {
  invoke<D extends RoutineDef>(definition: D, args: ArgsOf<D>): Promise<ResultOf<D>> {
    return this.call(definition, args);
  }

  verifyCallTypes(): void {
    const scalar: Promise<number> = this.invoke(archive, [new Date(), 7n]);
    const rows: Promise<readonly bigint[]> = this.invoke(activeIds, [3n]);
    const nothing: Promise<void> = this.invoke(rebuild, []);
    void scalar;
    void rows;
    void nothing;

    // @ts-expect-error the declaration has two input parameters.
    void this.invoke(archive, [new Date()]);

    // @ts-expect-error bigint routine parameters take bigint, not number.
    void this.invoke(archive, [new Date(), 7]);

    // @ts-expect-error timestamp routine parameters take Date, not their wire string.
    void this.invoke(archive, ['2026-01-01T00:00:00.000Z', 7n]);
  }
}

void FrozenRepositorySurface;
