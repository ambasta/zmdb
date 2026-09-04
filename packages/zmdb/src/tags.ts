// zmdb/tags — explicit named re-exports of the type-first declaration vocabulary.
// (No `export *`: each symbol is enumerated so the umbrella surface is explicit.)
//
// Types only. This subpath contributes nothing to a bundle, which is asserted by
// `schema-core/src/tags/erasure.spec.ts`.
//
// Not to be confused with the `tags` *value* re-exported from `zmdb` itself, which
// is `@zmdb/aot-validator`'s runtime `Rule` builder. The two overlap on five
// constraints under two spellings — see `PLAN-type-first.md` D6.
export type {
  Codec,
  Fts,
  HasDefault,
  Length,
  ManyToMany,
  ManyToOne,
  Max,
  MaxLength,
  Min,
  MinLength,
  NonNull,
  Nullable,
  Numeric,
  OneToMany,
  OneToOne,
  Pattern,
  PrimaryKey,
  Proto,
  ProtoField,
  References,
  Rule,
  Sensitive,
  Serial,
  Sql,
  Table,
  Unique,
} from '@zmdb/schema-core/tags';
