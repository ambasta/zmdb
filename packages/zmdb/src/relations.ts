// zmdb/relations — explicit named re-exports of the relations surface.
//
// A relation is declared on the type it belongs to — `orders?: Order[] & OneToMany<'orders',
// 'userId'>`, from `@zmdb/schema-core/tags` — so there are no builders here to construct one
// with, and no relations map to pass anywhere. What a consumer needs is resolution and the
// two row helpers. `Populated`/`PopulatedEntity` live on `@zmdb/schema-core/derive` with the
// rest of the type derivation.
export { aliasRow, attachPopulated, compilePopulate, resolveRelation } from '@zmdb/schema-core/relations';
export type { JoinRow, PopulateDialect, PopulateQuery, ResolvedRelation } from '@zmdb/schema-core/relations';
