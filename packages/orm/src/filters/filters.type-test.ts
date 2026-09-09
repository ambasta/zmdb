// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import {
  type FilterDef,
  type FilterOverrides,
  type FilterParams,
  type ReadOptions,
  type WriteOptions,
} from '@zmdb/orm';
import { type Equal, type Expect, type Mutual } from '@zmdb/schema';

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

type _NamesStayLiteral = Expect<Mutual<(typeof filters)[number]['name'], 'tenant' | 'active'>>;
type _TenantParamsStayExact = Expect<Equal<FilterParams<typeof tenantFilter>, { readonly tenantId: number }>>;
type _ActiveParamsStayVoid = Expect<Equal<FilterParams<typeof activeFilter>, void>>;
type _OverridesHaveOnlyDeclaredNames = Expect<Mutual<keyof FilterOverrides<typeof filters>, 'tenant' | 'active'>>;

function acceptsReadOptions(_options: ReadOptions<typeof filters>): void {}
function acceptsWriteOptions(_options: WriteOptions<typeof filters>): void {}

acceptsReadOptions({ filters: { tenant: { tenantId: 7 } } });
acceptsReadOptions({ filters: { tenant: false, active: false } });
acceptsReadOptions({});
acceptsWriteOptions({ filters: { tenant: { tenantId: 7 }, active: false } });
acceptsWriteOptions({ invalidateTags: ['users'], filters: { tenant: false } });

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
