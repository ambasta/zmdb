// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

/**
 * A build-time mapping from declared TypeScript names to physical SQL names.
 *
 * The reflector calls these functions once and stores their answers in `SchemaIR`.
 * Query compilation and row handling never receive a strategy.
 */
export interface NamingStrategy {
  readonly column?: (property: string, context: { readonly table: string }) => string;
  readonly table?: (declared: string) => string;
  readonly index?: (table: string, columns: readonly string[], unique: boolean) => string;
}

export type NamingStrategyName = 'snake_case' | 'snake_case_plural';
export type NamingStrategyConfig = NamingStrategy | NamingStrategyName | undefined;

const IRREGULAR_PLURALS = new Map([
  ['child', 'children'],
  ['index', 'indices'],
  ['man', 'men'],
  ['matrix', 'matrices'],
  ['person', 'people'],
  ['woman', 'women'],
]);
const IRREGULAR_PLURAL_FORMS = new Set(IRREGULAR_PLURALS.values());
const UNINFLECTED = new Set([
  'data',
  'equipment',
  'fish',
  'information',
  'metadata',
  'news',
  'series',
  'sheep',
  'species',
]);

function toSnakeCase(value: string): string {
  return value
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replaceAll(/([a-z\d])([A-Z])/g, '$1_$2')
    .replaceAll(/[-\s]+/g, '_')
    .toLowerCase();
}

function pluralizeWord(word: string): string {
  const lower = word.toLowerCase();
  if (word.length === 0 || UNINFLECTED.has(lower) || IRREGULAR_PLURAL_FORMS.has(lower)) return word;

  const irregular = IRREGULAR_PLURALS.get(lower);
  if (irregular !== undefined) return irregular;

  // Keep an already-plural declaration stable. The guarded endings are singular
  // words that happen to end in `s` and still need the explicit `-es` rule below.
  if (
    lower.endsWith('s') &&
    !lower.endsWith('ss') &&
    !lower.endsWith('us') &&
    !lower.endsWith('is') &&
    !lower.endsWith('as') &&
    !lower.endsWith('os') &&
    lower !== 'status' &&
    lower !== 'alias'
  ) {
    return word;
  }

  if (/[^aeiou]y$/i.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(?:s|x|z|ch|sh)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

function pluralizeTable(value: string): string {
  const words = value.split('_');
  const last = words.at(-1);
  if (last === undefined) return value;
  words[words.length - 1] = pluralizeWord(last);
  return words.join('_');
}

function indexName(table: string, columns: readonly string[], unique: boolean): string {
  return `${toSnakeCase(table)}_${columns.map(toSnakeCase).join('_')}_${unique ? 'uniq' : 'idx'}`;
}

export const snakeCase: NamingStrategy = Object.freeze({
  column: toSnakeCase,
  table: toSnakeCase,
  index: indexName,
});

export const snakeCasePlural: NamingStrategy = Object.freeze({
  column: toSnakeCase,
  table: (declared: string) => pluralizeTable(toSnakeCase(declared)),
  index: (table: string, columns: readonly string[], unique: boolean) =>
    indexName(pluralizeTable(toSnakeCase(table)), columns, unique),
});

const IDENTITY: NamingStrategy = Object.freeze({});

/** Resolve a config spelling once, before reflection begins. */
export function resolveNaming(config: NamingStrategyConfig): NamingStrategy {
  if (config === undefined) return IDENTITY;
  if (typeof config !== 'string') return config;
  if (config === 'snake_case') return snakeCase;
  if (config === 'snake_case_plural') return snakeCasePlural;
  throw new TypeError(`Unknown naming strategy ${JSON.stringify(config)}`);
}

export function singularizeWord(word: string): string {
  if (!word) return word;
  const lower = word.toLowerCase();

  if (
    lower.endsWith('ss') ||
    lower.endsWith('us') ||
    lower.endsWith('is') ||
    lower.endsWith('as') ||
    lower.endsWith('os') ||
    lower === 'series' ||
    lower === 'species' ||
    lower === 'news' ||
    lower === 'lens'
  ) {
    return word;
  }

  if (lower === 'people') return 'person';
  if (lower === 'children') return 'child';
  if (lower === 'men') return 'man';
  if (lower === 'women') return 'woman';
  if (lower === 'matrices') return 'matrix';
  if (lower === 'indices') return 'index';

  if (/([^aeiou])ies$/i.test(word)) return `${word.slice(0, -3)}y`;
  if (/lves$/i.test(word)) return `${word.slice(0, -4)}lf`;
  if (/(kn|w)ives$/i.test(word)) return `${word.slice(0, -4)}ife`;
  if (/eaves$/i.test(word)) return `${word.slice(0, -5)}eaf`;

  if (/sses$/i.test(word) || /statuses$/i.test(word) || /aliases$/i.test(word)) {
    return word.slice(0, -2);
  }
  if (/ises$/i.test(word)) return `${word.slice(0, -4)}is`;
  if (/(xes|ches|shes|zzes)$/i.test(word)) return word.slice(0, -2);
  if (/([aeiou])zes$/i.test(word)) return word.slice(0, -1);
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/**
 * Singularize each physical-name word through the repository's explicit rule set and
 * PascalCase the result. The physical table remains on `Table<'...'>`; this name is only
 * the generated TypeScript identifier.
 */
export function singularPascalCase(value: string): string {
  return value
    .split(/[-_]+/)
    .map(word => singularizeWord(word))
    .map(word => (word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : ''))
    .join('');
}
