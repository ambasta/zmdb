import { dialectTraits, type DialectTarget } from './dialects/index.js';

/**
 * Safely quote a single SQL identifier (table name, column name, alias, etc.)
 * according to the target database dialect, escaping internal quote characters.
 *
 * PostgreSQL & SQLite: double quotes (`"`), escaping internal double quotes as `""`.
 * MySQL: backticks (`` ` ``), escaping internal backticks as ``` `` ```.
 */
export function quoteIdentifier(dialect: DialectTarget, identifier: string): string {
  const [open, close] = dialectTraits(dialect).quote;
  const escaped = identifier.replaceAll(close, close + close);
  return `${open}${escaped}${close}`;
}

/**
 * Safely quote a column reference that may be dot-qualified (e.g. `schema.table.column` or `table.*`).
 * Each identifier segment is quoted individually, while wildcard `*` segments remain unquoted.
 */
export function quoteColumn(dialect: DialectTarget, col: string): string {
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
export function quoteTable(dialect: DialectTarget, tableSpec: string): string {
  const { table, alias } = splitTableSpec(tableSpec);
  const tablePart = quoteColumn(dialect, table);
  return alias === undefined ? tablePart : `${tablePart} AS ${quoteIdentifier(dialect, alias)}`;
}

/**
 * Generates dialect-specific 1-based parameter placeholders:
 * - PostgreSQL uses numbered sequential indices (`$1`, `$2`, ...)
 * - MySQL and SQLite use positional tokens (`?`)
 */
export function formatPlaceholder(dialect: DialectTarget, index: number): string {
  switch (dialectTraits(dialect).placeholder) {
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
export function renumberPlaceholders(text: string, offset: number, dialect: DialectTarget): string {
  switch (dialectTraits(dialect).placeholder) {
    case 'numbered':
      return text.replace(/\$(\d+)/g, (_match, n: string) => `$${offset + Number(n)}`);
    case 'named':
      return text.replace(/@p(\d+)/g, (_match, n: string) => `@p${offset + Number(n)}`);
    case 'positional':
      return text;
  }
}

export interface SanitizedExpression {
  text: string;
  parameters: readonly unknown[];
}

const SQL_KEYWORDS = new Set([
  'ALL',
  'AND',
  'ANY',
  'AS',
  'ASC',
  'AVG',
  'BETWEEN',
  'BIGINT',
  'BOOLEAN',
  'BOTH',
  'BY',
  'CASE',
  'CAST',
  'CHAR',
  'CHARACTER',
  'COALESCE',
  'CONCAT',
  'COUNT',
  'CROSS',
  'CURRENT_DATE',
  'CURRENT_TIME',
  'CURRENT_TIMESTAMP',
  'CURRENT_USER',
  'DATE',
  'DECIMAL',
  'DESC',
  'DISTINCT',
  'DOUBLE',
  'ELSE',
  'END',
  'EXISTS',
  'FALSE',
  'FILTER',
  'FLOAT',
  'FOR',
  'FOREIGN',
  'FROM',
  'FULL',
  'GROUP',
  'HAVING',
  'ILIKE',
  'IN',
  'INNER',
  'INT',
  'INTEGER',
  'INTO',
  'IS',
  'JOIN',
  'JSON',
  'JSONB',
  'LEADING',
  'LEFT',
  'LIKE',
  'LIMIT',
  'MAX',
  'MIN',
  'NOT',
  'NULL',
  'NULLIF',
  'NULLS',
  'NUMERIC',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'OUTER',
  'OVER',
  'PRECISION',
  'PRIMARY',
  'REAL',
  'RIGHT',
  'SELECT',
  'SMALLINT',
  'SOME',
  'SUBSTRING',
  'SUM',
  'THEN',
  'TIME',
  'TIMESTAMP',
  'TO',
  'TRAILING',
  'TRIM',
  'TRUE',
  'UNION',
  'UNIQUE',
  'USER',
  'USING',
  'VALUES',
  'VARCHAR',
  'WHEN',
  'WHERE',
  'WITH',
]);

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Sanitizes raw expression escape hatches by quoting column identifiers with dialect-aware escaping
 * and extracting literals and dynamic parameters into safe positional query parameters.
 */
export function sanitizeExpression(
  rawExpr: string,
  dialect: DialectTarget,
  params?: readonly unknown[] | Record<string, unknown>,
  startingParamIndex: number = 0,
): SanitizedExpression {
  if (!rawExpr || typeof rawExpr !== 'string') {
    return { text: '', parameters: [] };
  }

  const extractedParams: unknown[] = [];
  let paramIndex = startingParamIndex;
  let positionalParamIdx = 0;
  const exprParamsArray = Array.isArray(params) ? params : undefined;
  const exprParamsObj = isRecordObject(params) ? params : undefined;

  let outputSql = '';
  let pos = 0;
  const len = rawExpr.length;

  while (pos < len) {
    const ch = rawExpr.charAt(pos);

    // 1. Whitespace
    if (/\s/.test(ch)) {
      outputSql += ch;
      pos++;
      continue;
    }

    // 2. Single-quoted String Literal: '...'
    if (ch === "'") {
      let strVal = '';
      pos++; // skip opening '
      while (pos < len) {
        if (rawExpr.charAt(pos) === "'") {
          if (pos + 1 < len && rawExpr.charAt(pos + 1) === "'") {
            strVal += "'";
            pos += 2;
          } else {
            pos++; // skip closing '
            break;
          }
        } else {
          strVal += rawExpr.charAt(pos);
          pos++;
        }
      }
      paramIndex++;
      outputSql += formatPlaceholder(dialect, paramIndex);
      extractedParams.push(strVal);
      continue;
    }

    // 3. Quoted Identifiers: "..." or `...`
    if (ch === '"' || ch === '`') {
      const q = ch;
      let idVal = '';
      pos++;
      while (pos < len) {
        if (rawExpr.charAt(pos) === q) {
          if (pos + 1 < len && rawExpr.charAt(pos + 1) === q) {
            idVal += q;
            pos += 2;
          } else {
            pos++;
            break;
          }
        } else {
          idVal += rawExpr.charAt(pos);
          pos++;
        }
      }
      outputSql += quoteColumn(dialect, idVal);
      continue;
    }

    // 4. Postgres Type Cast Syntax: ::type
    if (ch === ':' && pos + 1 < len && rawExpr.charAt(pos + 1) === ':') {
      outputSql += '::';
      pos += 2;
      let typeStr = '';
      while (pos < len) {
        const tCh = rawExpr.charAt(pos);
        if (/[a-zA-Z0-9_\s(),]/.test(tCh)) {
          if (
            tCh === ')' &&
            (typeStr.includes('(') ? typeStr.split('(').length === typeStr.split(')').length + 1 : false)
          ) {
            typeStr += tCh;
            pos++;
            break;
          }
          if (
            (tCh === ' ' || tCh === '\t' || tCh === '\n') &&
            typeStr.length > 0 &&
            !typeStr.endsWith('double') &&
            !typeStr.endsWith('character') &&
            !typeStr.endsWith('varying') &&
            !typeStr.endsWith('with') &&
            !typeStr.endsWith('without') &&
            !typeStr.endsWith('time') &&
            !typeStr.endsWith('timestamp') &&
            !typeStr.includes('(')
          ) {
            break;
          }
          typeStr += tCh;
          pos++;
        } else {
          break;
        }
      }
      outputSql += typeStr.trimEnd();
      continue;
    }

    // 5. Named Parameter: :paramName
    if (ch === ':' && pos + 1 < len && /[a-zA-Z_]/.test(rawExpr.charAt(pos + 1))) {
      let pName = '';
      pos++; // skip :
      while (pos < len && /[a-zA-Z0-9_]/.test(rawExpr.charAt(pos))) {
        pName += rawExpr.charAt(pos);
        pos++;
      }
      let val: unknown = undefined;
      if (exprParamsObj && pName in exprParamsObj) {
        val = exprParamsObj[pName];
      } else if (exprParamsArray && positionalParamIdx < exprParamsArray.length) {
        val = exprParamsArray[positionalParamIdx++];
      }
      paramIndex++;
      outputSql += formatPlaceholder(dialect, paramIndex);
      extractedParams.push(val);
      continue;
    }

    // 6. Positional Placeholder: ?
    if (ch === '?') {
      pos++;
      let val: unknown = undefined;
      if (exprParamsArray && positionalParamIdx < exprParamsArray.length) {
        val = exprParamsArray[positionalParamIdx++];
      }
      paramIndex++;
      outputSql += formatPlaceholder(dialect, paramIndex);
      extractedParams.push(val);
      continue;
    }

    // 7. Postgres Numbered Placeholder: $1, $2, etc.
    if (ch === '$' && pos + 1 < len && /\d/.test(rawExpr.charAt(pos + 1))) {
      pos++; // skip $
      let numStr = '';
      while (pos < len && /\d/.test(rawExpr.charAt(pos))) {
        numStr += rawExpr.charAt(pos);
        pos++;
      }
      const n = Number(numStr);
      let val: unknown = undefined;
      if (exprParamsArray && n - 1 < exprParamsArray.length) {
        val = exprParamsArray[n - 1];
      }
      paramIndex++;
      outputSql += formatPlaceholder(dialect, paramIndex);
      extractedParams.push(val);
      continue;
    }

    // 8. Numeric Literal
    if (/\d/.test(ch)) {
      const lastOutputCh = outputSql.length > 0 ? outputSql.charAt(outputSql.length - 1) : '';
      if (!/[a-zA-Z0-9_.]/.test(lastOutputCh)) {
        let numStr = '';
        let hasDot = false;
        while (pos < len) {
          const nCh = rawExpr.charAt(pos);
          if (/\d/.test(nCh)) {
            numStr += nCh;
            pos++;
          } else if (nCh === '.' && !hasDot && pos + 1 < len && /\d/.test(rawExpr.charAt(pos + 1))) {
            hasDot = true;
            numStr += '.';
            pos++;
          } else {
            break;
          }
        }
        paramIndex++;
        outputSql += formatPlaceholder(dialect, paramIndex);
        extractedParams.push(Number(numStr));
        continue;
      }
    }

    // 9. Word Tokens (Identifiers / Keywords / Functions)
    if (/[a-zA-Z_]/.test(ch)) {
      let wordToken = '';
      while (pos < len) {
        const wCh = rawExpr.charAt(pos);
        if (/[a-zA-Z0-9_.]/.test(wCh)) {
          wordToken += wCh;
          pos++;
        } else {
          break;
        }
      }

      let lookaheadPos = pos;
      while (lookaheadPos < len && /\s/.test(rawExpr.charAt(lookaheadPos))) {
        lookaheadPos++;
      }
      const isFunction = lookaheadPos < len && rawExpr.charAt(lookaheadPos) === '(';

      if (isFunction) {
        outputSql += wordToken;
      } else {
        const upper = wordToken.toUpperCase();
        if (SQL_KEYWORDS.has(upper)) {
          outputSql += wordToken;
        } else {
          outputSql += quoteColumn(dialect, wordToken);
        }
      }
      continue;
    }

    // 10. Operators / Punctuation
    outputSql += ch;
    pos++;
  }

  return {
    text: outputSql,
    parameters: Object.freeze(extractedParams),
  };
}
