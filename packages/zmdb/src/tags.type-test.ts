// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// The compatibility tag subpath is curated rather than `export *`, so a new schema-core
// tag needs a type-level check that the documented `@zmdb/core/tags` route carries the
// exact same nominal symbol.

import { type Physical as UmbrellaPhysical } from '@zmdb/core/tags';
import { type Equal, type Expect } from '@zmdb/schema';
import { type Physical as SchemaCorePhysical } from '@zmdb/schema/tags';

export type _PhysicalTagIsReexportedByTheUmbrella = Expect<
  Equal<UmbrellaPhysical<'account_records'>, SchemaCorePhysical<'account_records'>>
>;
