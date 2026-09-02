// zmdb/derive — explicit named re-exports of the DTO suite derived from a tagged
// type. (No `export *`: each symbol is enumerated so the umbrella surface is
// explicit.)
//
// Types only; contributes nothing to a bundle.
//
// These names also exist on `zmdb` itself, derived from a `defineSchema` value. That
// duplication is temporary: per `PLAN-type-first.md` D2 the tagged versions are the
// ones that survive, and Phase 9 deletes the others and re-points the root here.
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
