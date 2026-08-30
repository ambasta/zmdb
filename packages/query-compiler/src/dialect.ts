// Shared SQL dialect formatting utility for identifier quoting and parameter placeholders.
export type Dialect = 'postgres' | 'mysql' | 'sqlite';

/**
 * Quotes a single identifier according to dialect rules:
 * - PostgreSQL and SQLite use double quotes (")
 * - MySQL uses backticks (`)
 * Wildcard '*' is preserved without quotes. Internal quote characters are escaped.
 */
export function quoteIdentifier(dialect: Dialect, identifier: string): string {
  if (identifier === '*') return '*';
  const q = dialect === 'mysql' ? '`' : '"';
  const escaped = identifier.replaceAll(q, q + q);
  return `${q}${escaped}${q}`;
}

/**
 * Formats single and compound identifiers, supporting:
 * - Table alias clauses (`table as alias` -> `"table" AS "alias"`)
 * - Dot-qualified column references (`x.y` -> `"x"."y"`, `x.*` -> `"x".*`)
 * - Schema-qualified objects (`schema.table` -> `"schema"."table"`)
 */
export function formatIdentifier(dialect: Dialect, identifier: string): string {
  const trimmed = identifier.trim();
  const aliasMatch = /^(.+?)\s+as\s+(.+)$/i.exec(trimmed);
  if (aliasMatch) {
    const left = formatIdentifier(dialect, aliasMatch[1]!);
    const right = formatIdentifier(dialect, aliasMatch[2]!);
    return `${left} AS ${right}`;
  }
  if (trimmed.includes('.')) {
    return trimmed
      .split('.')
      .map(part => quoteIdentifier(dialect, part))
      .join('.');
  }
  return quoteIdentifier(dialect, trimmed);
}

/**
 * Legacy aliases for backwards compatibility with quoting engine.
 */
export function quoteColumn(dialect: Dialect, col: string): string {
  return formatIdentifier(dialect, col);
}

export function quoteTable(dialect: Dialect, tableSpec: string): string {
  return formatIdentifier(dialect, tableSpec);
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
