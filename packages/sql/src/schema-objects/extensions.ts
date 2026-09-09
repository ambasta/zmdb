// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { type SqlDialect } from '../index.js';
import type { ExtensionDef } from './types.js';

export type { ExtensionDef } from './types.js';

export function createExtensionDdl(definition: ExtensionDef, dialect: SqlDialect): string {
  const statements = dialect.migrations.emitSchemaObject({ kind: 'create_extension', definition });
  if (statements.length !== 1 || statements[0] === undefined) {
    throw new TypeError(`${dialect.name} extension emission must return exactly one statement`);
  }
  return statements[0];
}
