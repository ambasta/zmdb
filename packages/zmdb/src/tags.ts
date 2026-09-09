// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/tags — explicit named type exports for schema declarations.
// The inline type specifiers erase their bindings. With verbatimModuleSyntax,
// the emitted module retains an empty re-export from @zmdb/schema/tags.
export {
  type Codec,
  type Ext,
  type Fts,
  type HasDefault,
  type Length,
  type ManyToMany,
  type ManyToOne,
  type Max,
  type MaxLength,
  type Min,
  type MinLength,
  type NonNull,
  type Nullable,
  type Numeric,
  type OneToMany,
  type OneToOne,
  type Pattern,
  type Physical,
  type PrimaryKey,
  type Proto,
  type ProtoField,
  type References,
  type Rule,
  type Sensitive,
  type Serial,
  type Sql,
  type Table,
  type Unique,
} from '@zmdb/schema/tags';
