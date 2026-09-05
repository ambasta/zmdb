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
