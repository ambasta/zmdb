// The compatibility tag subpath is curated rather than `export *`, so a new schema-core
// tag needs a type-level check that the documented `zmdb/tags` route carries the
// exact same nominal symbol.

import type { Equal, Expect } from '@zmdb/schema-core';
import type { Physical as SchemaCorePhysical } from '@zmdb/schema-core/tags';
import type { Physical as UmbrellaPhysical } from 'zmdb/tags';

export type _PhysicalTagIsReexportedByTheUmbrella = Expect<
  Equal<UmbrellaPhysical<'account_records'>, SchemaCorePhysical<'account_records'>>
>;
