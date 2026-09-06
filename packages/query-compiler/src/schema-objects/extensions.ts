import type { SqlDialect } from '../index.js';
import type { ExtensionDef } from './types.js';

export type { ExtensionDef } from './types.js';

export function createExtensionDdl(definition: ExtensionDef, dialect: SqlDialect): string {
  const statements = dialect.migrations.emitSchemaObject({ kind: 'create_extension', definition });
  if (statements.length !== 1 || statements[0] === undefined) {
    throw new TypeError(`${dialect.name} extension emission must return exactly one statement`);
  }
  return statements[0];
}
