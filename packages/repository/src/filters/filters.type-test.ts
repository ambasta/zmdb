// Compile-only half of #449. The production exports do not exist in the tests-freeze
// slice, so these are the exact local shapes frozen by repository/SPEC.md §3c. The
// implementation slice replaces them with imports and keeps every assertion below.
//
// No `declare const`: every positive and negative call uses a concrete value.
import type { Equal, Expect, Mutual } from '@zmdb/schema-core';

interface FrozenPredicate {
  readonly col: string;
  readonly op: string;
  readonly value: unknown;
  readonly connector?: 'AND' | 'OR';
}

interface FilterDef<P = void> {
  readonly name: string;
  readonly where: (params: P) => readonly FrozenPredicate[];
  readonly enabled?: boolean;
  readonly appliesToWrites?: boolean;
}

const tenantFilter = {
  name: 'tenant',
  where: ({ tenantId }: { readonly tenantId: number }) => [{ col: 'tenantId', op: '=', value: tenantId }] as const,
} as const satisfies FilterDef<{ readonly tenantId: number }>;

const activeFilter = {
  name: 'active',
  where: (_params: void) => [{ col: 'active', op: '=', value: true }] as const,
  appliesToWrites: true,
} as const satisfies FilterDef;

const filters = [tenantFilter, activeFilter] as const;

type FilterParams<F> = F extends { readonly where: (params: infer P) => readonly FrozenPredicate[] } ? P : never;
type FilterOverride<F> = [FilterParams<F>] extends [void] ? false : FilterParams<F> | false;
type FilterOverrides<Defs extends readonly { readonly name: string }[]> = {
  readonly [Def in Defs[number] as Def['name']]?: FilterOverride<Def>;
};

interface ReadOptions<Defs extends readonly { readonly name: string }[]> {
  readonly filters?: FilterOverrides<Defs>;
}

type _NamesStayLiteral = Expect<Mutual<(typeof filters)[number]['name'], 'tenant' | 'active'>>;
type _TenantParamsStayExact = Expect<Equal<FilterParams<typeof tenantFilter>, { readonly tenantId: number }>>;
type _ActiveParamsStayVoid = Expect<Equal<FilterParams<typeof activeFilter>, void>>;
type _OverridesHaveOnlyDeclaredNames = Expect<Mutual<keyof FilterOverrides<typeof filters>, 'tenant' | 'active'>>;

function acceptsReadOptions(_options: ReadOptions<typeof filters>): void {}

acceptsReadOptions({ filters: { tenant: { tenantId: 7 } } });
acceptsReadOptions({ filters: { tenant: false, active: false } });
acceptsReadOptions({});

// @ts-expect-error - a filter name is closed over the repository's declared tuple.
acceptsReadOptions({ filters: { tenent: { tenantId: 7 } } });

// @ts-expect-error - the parameter object is the type accepted by this filter's where callback.
acceptsReadOptions({ filters: { tenant: { tenantId: '7' } } });

// @ts-expect-error - disabling is explicit per name; there is no blanket filters:false form.
acceptsReadOptions({ filters: false });

const rawSqlFilter = {
  name: 'raw',
  // @ts-expect-error - FilterDef.where returns predicates, never a SQL fragment.
  where: (_params: void) => '"tenantId" = $1',
} satisfies FilterDef;
void rawSqlFilter;

const invalidWritePolicy = {
  name: 'invalid-write-policy',
  where: (_params: void) => [] as const,
  // @ts-expect-error - appliesToWrites is a boolean policy, not a mode string.
  appliesToWrites: 'reads-only',
} satisfies FilterDef;
void invalidWritePolicy;
