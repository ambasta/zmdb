import { UnsupportedFeatureError } from '../errors.js';
import type { Dialect } from '../index.js';
import { quoteIdentifier } from '../quoting.js';

export interface ExtensionDef {
  readonly name: string;
  readonly schema?: string;
  readonly version?: string;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function createExtensionDdl(def: ExtensionDef, dialect: Dialect): string {
  if (dialect !== 'postgres') {
    throw new UnsupportedFeatureError(
      `extension "${def.name}"`,
      dialect,
      `${dialect} does not support database extensions ("${def.name}")`,
    );
  }
  const schema = def.schema === undefined ? '' : ` WITH SCHEMA ${quoteIdentifier(dialect, def.schema)}`;
  const version = def.version === undefined ? '' : ` VERSION ${quoteLiteral(def.version)}`;
  return `CREATE EXTENSION IF NOT EXISTS ${quoteIdentifier(dialect, def.name)}${schema}${version}`;
}
