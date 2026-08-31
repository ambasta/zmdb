import type { Dialect } from './index.ts';

/**
 * Safely quote a single SQL identifier (table name, column name, alias, etc.)
 * according to the target database dialect, escaping internal quote characters.
 *
 * PostgreSQL & SQLite: double quotes (`"`), escaping internal double quotes as `""`.
 * MySQL: backticks (`` ` ``), escaping internal backticks as ``` `` ```.
 */
export function quoteIdentifier(dialect: Dialect, identifier: string): string {
  if (dialect === 'mysql') {
    const escaped = identifier.replaceAll('`', '``');
    return `\`${escaped}\``;
  }
  const escaped = identifier.replaceAll('"', '""');
  return `"${escaped}"`;
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
  return ch !== undefined && (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r');
}

/**
 * Safely quote a table specification, which may be a table name (optionally dot-qualified)
 * or a table alias expression (e.g. `table as alias` or `schema.table AS alias`).
 */
export function quoteTable(dialect: Dialect, tableSpec: string): string {
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
      const tableStr = trimmed.slice(0, asIndex).trim();
      const aliasStr = trimmed.slice(asIndex + 2).trim();
      if (tableStr.length > 0 && aliasStr.length > 0) {
        const tablePart = quoteColumn(dialect, tableStr);
        const aliasPart = quoteIdentifier(dialect, aliasStr);
        return `${tablePart} AS ${aliasPart}`;
      }
    }
    searchIndex = asIndex + 2;
  }
  return quoteColumn(dialect, trimmed);
}

/**
 * Generates dialect-specific 1-based parameter placeholders:
 * - PostgreSQL uses stateful sequential indices (`$1`, `$2`, ...)
 * - MySQL and SQLite use stateless tokens (`?`)
 */
export function formatPlaceholder(dialect: Dialect, index: number): string {
  return dialect === 'postgres' ? `$${index}` : '?';
}

/**
 * Renumbers positional parameter placeholders ($n) in SQL text by adding an offset.
 * Used when combining parameter sets (e.g. set operations like UNION).
 */
export function renumberPlaceholders(text: string, offset: number): string {
  return text.replace(/\$(\d+)/g, (_match, n: string) => `$${offset + Number(n)}`);
}
