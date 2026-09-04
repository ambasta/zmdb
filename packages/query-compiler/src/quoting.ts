import { TRAITS, type Dialect } from './dialects/index.js';

/**
 * Safely quote a single SQL identifier (table name, column name, alias, etc.)
 * according to the target database dialect, escaping internal quote characters.
 *
 * PostgreSQL & SQLite: double quotes (`"`), escaping internal double quotes as `""`.
 * MySQL: backticks (`` ` ``), escaping internal backticks as ``` `` ```.
 */
export function quoteIdentifier(dialect: Dialect, identifier: string): string {
  const [open, close] = TRAITS[dialect].quote;
  const escaped = identifier.replaceAll(close, close + close);
  return `${open}${escaped}${close}`;
}

/**
 * Safely quote a column reference that may be dot-qualified (e.g. `schema.table.column` or `table.*`).
 * Each identifier segment is quoted individually, while wildcard `*` segments remain unquoted.
 */
export function quoteColumn(dialect: Dialect, col: string): string {
  return col
    .split('.')
    .map(segment => (segment === '*' ? '*' : quoteIdentifier(dialect, segment)))
    .join('.');
}

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

interface TableSpec {
  readonly table: string;
  readonly alias?: string;
}

function splitTableSpec(tableSpec: string): TableSpec {
  const trimmed = tableSpec.trim();
  const lower = trimmed.toLowerCase();
  let searchIndex = 0;
  while (searchIndex < lower.length) {
    const asIndex = lower.indexOf('as', searchIndex);
    if (asIndex === -1) {
      break;
    }
    const hasSpaceBefore = isWhitespace(trimmed[asIndex - 1]);
    const hasSpaceAfter = isWhitespace(trimmed[asIndex + 2]);

    if (hasSpaceBefore && hasSpaceAfter) {
      const table = trimmed.slice(0, asIndex).trim();
      const alias = trimmed.slice(asIndex + 2).trim();
      if (table.length > 0 && alias.length > 0) {
        return { table, alias };
      }
    }
    searchIndex = asIndex + 2;
  }
  return { table: trimmed };
}

/** The primary table named by a table specification, without an optional alias. */
export function unaliasedTable(tableSpec: string): string {
  return splitTableSpec(tableSpec).table;
}

/**
 * Safely quote a table specification, which may be a table name (optionally dot-qualified)
 * or a table alias expression (e.g. `table as alias` or `schema.table AS alias`).
 *
 * Uses manual scanning for `AS` boundaries to avoid polynomial regex backtracking (ReDoS)
 * on arbitrary table specification inputs.
 */
export function quoteTable(dialect: Dialect, tableSpec: string): string {
  const { table, alias } = splitTableSpec(tableSpec);
  const tablePart = quoteColumn(dialect, table);
  return alias === undefined ? tablePart : `${tablePart} AS ${quoteIdentifier(dialect, alias)}`;
}

/**
 * Generates dialect-specific 1-based parameter placeholders:
 * - PostgreSQL uses numbered sequential indices (`$1`, `$2`, ...)
 * - MySQL and SQLite use positional tokens (`?`)
 */
export function formatPlaceholder(dialect: Dialect, index: number): string {
  switch (TRAITS[dialect].placeholder) {
    case 'numbered':
      return `$${index}`;
    case 'positional':
      return '?';
    case 'named':
      return `@p${index}`;
  }
}

/**
 * Renumbers numbered (`$n`) or named (`@pN`) placeholders by adding an offset.
 * Positional `?` placeholders are already ordered by the parameter array and are unchanged.
 *
 * Note: Designed for compiler-generated SQL where literal values are always
 * parameterized into placeholders. Does not parse raw SQL string literals or comments
 * where a generated placeholder pattern might appear as literal text.
 */
export function renumberPlaceholders(text: string, offset: number, dialect: Dialect): string {
  switch (TRAITS[dialect].placeholder) {
    case 'numbered':
      return text.replace(/\$(\d+)/g, (_match, n: string) => `$${offset + Number(n)}`);
    case 'named':
      return text.replace(/@p(\d+)/g, (_match, n: string) => `@p${offset + Number(n)}`);
    case 'positional':
      return text;
  }
}
