// zmdb/derive — explicit named re-exports of the DTO suite derived from a tagged
// type. (No `export *`: each symbol is enumerated so the compatibility surface is
// explicit.)
//
// Types only; contributes nothing to a bundle.
//
// Four of these names — `Entity`, `CreateDTO`, `UpdateDTO`, `PrimaryKeyOf` — are also on
// `zmdb` itself. They are the same types: the root used to define schema-value twins that
// deferred here when the value carried a phantom, and those are gone, so both paths now
// resolve to the definitions in `@zmdb/schema-core/derive`. Import from whichever reads
// better at the use site.
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
