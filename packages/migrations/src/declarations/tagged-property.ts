// The one printer from normalized column facts to a tagged TypeScript property.
//
// Both the defineSchema codemod and catalog declaration emitter call this module. Keeping
// the tag order and nullable-intersection parentheses here prevents those two generated
// paths from producing declarations that reflect differently.

import type { ExtensionType } from '@zmdb/query-compiler';

export interface TaggedPropertyColumn {
  readonly sql: string | ExtensionType;
  readonly nullable?: boolean;
  readonly primaryKey?: boolean;
  readonly unique?: boolean;
  readonly hasDefault?: boolean;
  readonly sensitive?: boolean;
  readonly length?: number;
  readonly enumValues?: readonly string[];
  readonly payload?: string;
  readonly references?: string;
  readonly constraints?: readonly (readonly [tag: string, value: string | number])[];
  readonly rules?: readonly string[];
}

export type TaggedPropertyResult =
  | { readonly source: string; readonly tags: readonly string[] }
  | { readonly reason: string };

const TS_TYPE: Readonly<Record<string, string>> = Object.freeze({
  serial: 'number',
  integer: 'number',
  numeric: 'number',
  bigint: 'bigint',
  text: 'string',
  varchar: 'string',
  boolean: 'boolean',
  timestamp: 'Date',
});

function extensionBase(type: ExtensionType): string | undefined {
  if (type.extension === 'citext' && type.name === 'citext') return 'string';
  if (type.extension === 'vector' && type.name === 'vector') return 'readonly number[]';
  return undefined;
}

function extensionName(type: ExtensionType): string {
  const args = type.args ?? [];
  return args.length === 0 ? type.name : `${type.name}(${args.map(String).join(',')})`;
}

function extensionTag(type: ExtensionType): string | undefined {
  const args = type.args ?? [];
  if (args.some(value => typeof value === 'number' && !Number.isFinite(value))) return undefined;
  const parameters = [`'${escapeTypeString(type.extension)}'`, `'${escapeTypeString(type.name)}'`];
  if (args.length > 0) {
    parameters.push(
      `[${args.map(value => (typeof value === 'string' ? `'${escapeTypeString(value)}'` : String(value))).join(', ')}]`,
    );
  }
  return `Ext<${parameters.join(', ')}>`;
}

/** Escape a value for a single-quoted TypeScript string literal. */
export function escapeTypeString(value: unknown): string {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\r', '\\r')
    .replaceAll('\n', '\\n')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

/** Keep ordinary identifiers readable and quote every physical name that is not one. */
export function typescriptPropertyName(value: string): string {
  return /^[$A-Z_a-z][$\w]*$/.test(value) ? value : `'${escapeTypeString(value)}'`;
}

/**
 * Render one property, or return the reason no honest TypeScript property exists.
 *
 * The input is deliberately structural: the codemod and introspector normalize their
 * different sources into the same facts before this boundary.
 */
export function renderTaggedProperty(name: string, column: TaggedPropertyColumn): TaggedPropertyResult {
  const parts: string[] = [];
  const tags = new Set<string>();
  const use = (tag: string): void => {
    tags.add(tag.replace(/<[\s\S]*$/, ''));
    parts.push(tag);
  };

  if (typeof column.sql !== 'string') {
    const base = extensionBase(column.sql);
    if (base === undefined) {
      return { reason: `no TypeScript type for extension-backed SQL type \`${extensionName(column.sql)}\`` };
    }
    const tag = extensionTag(column.sql);
    if (tag === undefined) {
      return { reason: `extension-backed SQL type \`${extensionName(column.sql)}\` has an invalid argument` };
    }
    parts.push(base);
    use(tag);
  } else if (column.sql === 'jsonEnum') {
    if (!column.enumValues?.length) {
      return { reason: 'a `jsonEnum` column with no members has no type' };
    }
    parts.push(column.enumValues.map(value => `'${escapeTypeString(value)}'`).join(' | '));
  } else if (column.sql === 'json') {
    parts.push(column.payload ?? 'object');
    use(`Sql<'json'>`);
  } else {
    const base = TS_TYPE[column.sql];
    if (base === undefined) {
      return { reason: `no TypeScript type for SQL type \`${column.sql}\`` };
    }
    parts.push(base);
    use(`Sql<'${column.sql === 'serial' ? 'integer' : escapeTypeString(column.sql)}'>`);
  }

  if (column.length !== undefined) use(`Length<${String(column.length)}>`);
  if (column.sql === 'serial') use('Serial');
  else if (column.hasDefault === true) use('HasDefault');
  if (column.primaryKey === true) use('PrimaryKey');
  if (column.unique === true) use('Unique');
  if (column.sensitive === true) use('Sensitive');
  if (column.references !== undefined) use(`References<'${escapeTypeString(column.references)}'>`);
  for (const [tag, value] of column.constraints ?? []) {
    use(typeof value === 'string' ? `${tag}<'${escapeTypeString(value)}'>` : `${tag}<${String(value)}>`);
  }
  const rules = column.rules ?? [];
  if (rules.length > 0) {
    use(`Rule<${rules.map(rule => `'${escapeTypeString(rule)}'`).join(' | ')}>`);
  }

  const [base, ...propertyTags] = parts;
  if (base === undefined) return { reason: 'the column produced no TypeScript type' };
  const joined = propertyTags.length > 0 ? [needsParens(base) ? `(${base})` : base, ...propertyTags].join(' & ') : base;
  const type = column.nullable === true ? `(${joined}) | null` : joined;
  return {
    source: `  ${typescriptPropertyName(name)}: ${type};`,
    tags: [...tags],
  };
}

/**
 * Whether a type has to be bracketed before `&` is applied to it.
 *
 * `&` binds tighter than `|`, while a union carrying tags must keep those tags on every
 * member. The depth scan avoids mistaking a nested union inside a generic for a top-level
 * union.
 */
function needsParens(type: string): boolean {
  const pairs: Readonly<Record<string, string>> = { '<': '>', '(': ')', '[': ']', '{': '}' };
  const closers = new Set(Object.values(pairs));
  let depth = 0;
  for (let index = 0; index < type.length; index += 1) {
    const character = type[index];
    if (character !== undefined && character in pairs) depth += 1;
    else if (character !== undefined && closers.has(character)) depth -= 1;
    else if (depth === 0 && (character === '|' || type.startsWith('=>', index))) return true;
  }
  return false;
}
