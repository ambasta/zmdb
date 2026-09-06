// Type-level tests for query compiler.
// No runtime code: this file is a compile-time gate evaluated by `tsc`.
import type { Equal, Expect } from '@zmdb/schema-core';

import type { CompiledQuery, createQueryCompiler, Operator, QueryCompiler, QueryTelemetry } from './index.ts';

// createQueryCompiler returns QueryCompiler
export type _CompilerReturnType = Expect<Equal<ReturnType<typeof createQueryCompiler>, QueryCompiler>>;

// Operator union is bounded to supported emitters
export type _SupportedOperatorUnion = Expect<
  Equal<
    Operator,
    | '='
    | '!='
    | '<'
    | '<='
    | '>'
    | '>='
    | 'like'
    | 'ilike'
    | 'in'
    | 'not in'
    | 'nin'
    | 'is null'
    | 'is not null'
    | 'EXISTS'
    | 'NOT EXISTS'
    | 'exists'
    | 'not exists'
    | (string & {})
  >
>;

// CompiledQuery structure
export type _CompiledQueryShape = Expect<
  Equal<
    CompiledQuery,
    { readonly text: string; readonly parameters: readonly unknown[]; readonly telemetry?: QueryTelemetry }
  >
>;
