import {
  frozenQuery,
  queryTelemetry,
  renderPredicate,
  tailClause,
  type ComparisonPredicate,
  type PredicateGroup,
} from '../clauses.js';
import { dialectName, dialectTraits, type DialectTarget } from '../dialects/index.js';
import { UnsupportedFeatureError } from '../errors.js';
import type { CompiledQuery, QueryCompilerOptions } from '../index.js';
import { formatPlaceholder, quoteColumn, quoteIdentifier, quoteTable } from '../quoting.js';

export { UnsupportedFeatureError };

/**
 * An FTS5 term, quoted so that its own quotes cannot end the string.
 *
 * `unknown` rather than `string`, because a `Predicate`'s value is `unknown` — every other
 * operator takes one and binds it as a parameter — and the `String()` this always did is a
 * better answer for a caller who passes a number than an assertion at the one call site.
 */
export function escapeFts5Term(term: unknown): string {
  return `"${String(term).replace(/"/g, '""')}"`;
}

function parseTableSpec(spec: string): { baseName: string; alias?: string } {
  const m = /^(\S+)\s+(?:as\s+)?(\S+)$/i.exec(spec.trim());
  if (m && m[1] && m[2]) {
    return { baseName: m[1], alias: m[2] };
  }
  return { baseName: spec.trim() };
}

export interface FtsTableOptions {
  ftsTable?: string | boolean | undefined;
}

export interface FtsOptions extends FtsTableOptions, QueryCompilerOptions {}

interface Predicate {
  kind: 'match' | 'cmp';
  col: string;
  op?: string | undefined;
  value: unknown;
}
interface State {
  table: string;
  preds: Array<Predicate | PredicateGroup>;
  ftsTable?: string | boolean | undefined;
  limitN?: number | undefined;
  offsetN?: number | undefined;
}

export interface FtsSelect {
  whereMatch(column: string, term: string, options?: FtsTableOptions | string | boolean): FtsSelect;
  where(col: string, op: string, value: unknown): FtsSelect;
  whereGroup(predicates: readonly ComparisonPredicate[]): FtsSelect;
  limit(n: number): FtsSelect;
  offset(n: number): FtsSelect;
  compile(): CompiledQuery;
}

function make(d: DialectTarget, s: State, telemetry: boolean): FtsSelect {
  const next = (p: Partial<State>): FtsSelect => make(d, { ...s, ...p }, telemetry);
  return {
    whereMatch: (column, term, options) => {
      const ftsTable =
        s.ftsTable ?? (typeof options === 'string' || typeof options === 'boolean' ? options : options?.ftsTable);
      return next({ preds: [...s.preds, { kind: 'match', col: column, value: term }], ftsTable });
    },
    where: (col, op, value) => next({ preds: [...s.preds, { kind: 'cmp', col, op, value }] }),
    whereGroup: predicates => next({ preds: [...s.preds, { kind: 'group', predicates, connector: 'AND' }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      let text = '';
      const fts = dialectTraits(d).fts;

      if (fts === 'companionTable') {
        const { baseName, alias } = parseTableSpec(s.table);
        const quotedBaseTable = quoteTable(d, s.table);
        const baseRef = alias ? quoteIdentifier(d, alias) : quoteColumn(d, baseName);

        const hasMatch = s.preds.some(p => p.kind === 'match');
        if (hasMatch) {
          if (!s.ftsTable) {
            throw new UnsupportedFeatureError('full-text search', dialectName(d));
          }
          const ftsTableName = typeof s.ftsTable === 'string' ? s.ftsTable : `${baseName}_fts`;
          const ftsAlias = alias ? `${alias}_fts` : undefined;
          const quotedFtsTable = ftsAlias
            ? `${quoteColumn(d, ftsTableName)} AS ${quoteIdentifier(d, ftsAlias)}`
            : quoteColumn(d, ftsTableName);
          const ftsRef = ftsAlias ? quoteIdentifier(d, ftsAlias) : quoteColumn(d, ftsTableName);

          text = `SELECT * FROM ${quotedBaseTable} INNER JOIN ${quotedFtsTable} ON ${baseRef}.${quoteIdentifier(d, 'rowid')} = ${ftsRef}.${quoteIdentifier(d, 'rowid')}`;
        } else {
          text = `SELECT * FROM ${quotedBaseTable}`;
        }

        if (s.preds.length > 0) {
          const ftsTableName = typeof s.ftsTable === 'string' ? s.ftsTable : `${baseName}_fts`;
          const ftsAlias = alias ? `${alias}_fts` : undefined;
          const ftsRef = ftsAlias ? quoteIdentifier(d, ftsAlias) : quoteColumn(d, ftsTableName);

          const parts = s.preds.map(p => {
            if (p.kind === 'group') return renderPredicate(d, p, params);
            if (p.kind === 'match') {
              const colName = p.col.slice(p.col.lastIndexOf('.') + 1);
              params.push(escapeFts5Term(p.value));
              return `${ftsRef}.${quoteIdentifier(d, colName)} MATCH ${formatPlaceholder(d, params.length)}`;
            }
            return renderPredicate(d, { col: p.col, op: p.op ?? '=', value: p.value }, params);
          });
          text += ` WHERE ${parts.join(' AND ')}`;
        }
      } else {
        text = `SELECT * FROM ${quoteTable(d, s.table)}`;
        if (s.preds.length > 0) {
          const parts = s.preds.map(p => {
            if (p.kind === 'group') return renderPredicate(d, p, params);
            if (p.kind !== 'match') {
              return renderPredicate(d, { col: p.col, op: p.op ?? '=', value: p.value }, params);
            }
            params.push(p.value);
            if (fts === 'tsvector') {
              return `to_tsvector('english', ${quoteColumn(d, p.col)}) @@ to_tsquery('english', ${formatPlaceholder(d, params.length)})`;
            }
            if (fts === 'match') {
              return `MATCH(${quoteColumn(d, p.col)}) AGAINST(${formatPlaceholder(d, params.length)} IN NATURAL LANGUAGE MODE)`;
            }
            throw new UnsupportedFeatureError('full-text search', dialectName(d));
          });
          text += ` WHERE ${parts.join(' AND ')}`;
        }
      }

      text += tailClause(d, s);
      return frozenQuery(text, params, queryTelemetry(d, 'SELECT', s.table, telemetry));
    },
  };
}

export function ftsSelectFrom(
  table: string,
  dialect: DialectTarget = 'postgres',
  options?: FtsOptions | string | boolean,
): FtsSelect {
  const ftsTable = typeof options === 'string' || typeof options === 'boolean' ? options : options?.ftsTable;
  const telemetry = typeof options === 'object' && options?.telemetry === true;
  return make(dialect, { table, preds: [], ftsTable }, telemetry);
}
