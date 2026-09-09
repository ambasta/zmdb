// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/relations — explicit named re-exports of the relations surface.
//
// A relation is declared on the type it belongs to — `orders?: Order[] & OneToMany<'orders',
// 'userId'>`, from `@zmdb/schema/tags` — so there are no builders here to construct one
// with, and no relations map to pass anywhere. What a consumer needs is resolution and the
// two row helpers. `Populated`/`PopulatedEntity` live on `@zmdb/schema/derive` with the
// rest of the type derivation.
export { aliasRow, attachPopulated, compilePopulate } from '@zmdb/orm/relations';
export { resolveRelation } from '@zmdb/schema/relations';
export { type JoinRow, type PopulateDialect, type PopulateQuery } from '@zmdb/orm/relations';
export { type ResolvedRelation } from '@zmdb/schema/relations';
