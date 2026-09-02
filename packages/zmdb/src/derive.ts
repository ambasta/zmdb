// zmdb/derive — explicit named re-exports of the DTO suite derived from a tagged
// type. (No `export *`: each symbol is enumerated so the umbrella surface is
// explicit.)
//
// Types only; contributes nothing to a bundle.
//
// Four of these names — `Entity`, `CreateDTO`, `UpdateDTO`, `PrimaryKeyOf` — also exist on
// `zmdb` itself, where they take a schema *value* type and defer to the ones here when it
// carries a phantom. These are the definitions; the root's are the adapter for code still
// parameterised on a schema value rather than on its declared type.
export type {
  CreateDTO,
  DefaultKeys,
  Entity,
  NullableKeys,
  PrimaryKeyKeys,
  PrimaryKeyOf,
  ReadDTO,
  SensitiveKeys,
  SerialKeys,
  UniqueKeys,
  UpdateDTO,
  WhereDTO,
  Wire,
  WireCreateDTO,
} from '@zmdb/schema-core/derive';
