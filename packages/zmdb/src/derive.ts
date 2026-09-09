// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/derive — explicit named re-exports of the DTO suite derived from a tagged
// type. (No `export *`: each symbol is enumerated so the compatibility surface is
// explicit.)
//
// Types only; contributes nothing to a bundle.
//
// Four of these names — `Entity`, `CreateDTO`, `UpdateDTO`, `PrimaryKeyOf` — are also on
// `@zmdb/core` itself. They are the same types: the root used to define schema-value twins that
// deferred here when the value carried a phantom, and those are gone, so both paths now
// resolve to the definitions in `@zmdb/schema/derive`. Import from whichever reads
// better at the use site.
export {
  type CreateDTO,
  type DefaultKeys,
  type Entity,
  type NullableKeys,
  type PrimaryKeyKeys,
  type PrimaryKeyOf,
  type ReadDTO,
  type SensitiveKeys,
  type SerialKeys,
  type UniqueKeys,
  type UpdateDTO,
  type WhereDTO,
  type Wire,
  type WireCreateDTO,
} from '@zmdb/schema/derive';
