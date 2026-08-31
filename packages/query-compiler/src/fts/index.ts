import { UnsupportedFeatureError } from '../errors.ts';
// Query-builder full-text search — implementation (#95). Per-dialect whereMatch:
// pg to_tsvector/@@/to_tsquery; mysql MATCH...AGAINST; sqlite FTS5 JOIN compilation.
import type { CompiledQuery, Dialect } from '../index.ts';
import { quoteColumn, quoteIdentifier, quoteTable } from '../quoting.ts';

export { UnsupportedFeatureError };

export function escapeFts5Term(term: string): string {
  return `"${String(term).replace(/"/g, '""')}"`;
}

function parseTableSpec(spec: string): { baseName: string; alias?: string } {
  const m = /^(\S+)\s+(?:as\s+)?(\S+)$/i.exec(spec.trim());
  if (m && m[1] && m[2]) {
    return { baseName: m[1], alias: m[2] };
  }
  return { baseName: spec.trim() };
}

export interface FtsOptions {
  ftsTable?: string | boolean | undefined;
}

interface Predicate {
  kind: 'match' | 'cmp';
  col: string;
  op?: string | undefined;
  value: unknown;
}
interface State {
  table: string;
  preds: Predicate[];
  ftsTable?: string | boolean | undefined;
  limitN?: number | undefined;
  offsetN?: number | undefined;
}

export interface FtsSelect {
  whereMatch(column: string, term: string, options?: FtsOptions | string | boolean): FtsSelect;
  where(col: string, op: string, value: unknown): FtsSelect;
  limit(n: number): FtsSelect;
  offset(n: number): FtsSelect;
  compile(): CompiledQuery;
}

function make(d: Dialect, s: State): FtsSelect {
  const next = (p: Partial<State>): FtsSelect => make(d, { ...s, ...p });
  return {
    whereMatch: (column, term, options) => {
      const ftsTable =
        s.ftsTable ?? (typeof options === 'string' || typeof options === 'boolean' ? options : options?.ftsTable);
      return next({ preds: [...s.preds, { kind: 'match', col: column, value: term }], ftsTable });
    },
    where: (col, op, value) => next({ preds: [...s.preds, { kind: 'cmp', col, op, value }] }),
    limit: n => next({ limitN: n }),
    offset: n => next({ offsetN: n }),
    compile: () => {
      const params: unknown[] = [];
      let text = '';

      if (d === 'sqlite') {
        const { baseName, alias } = parseTableSpec(s.table);
        const quotedBaseTable = quoteTable(d, s.table);
        const baseRef = alias ? quoteIdentifier(d, alias) : quoteColumn(d, baseName);

        const hasMatch = s.preds.some(p => p.kind === 'match');
        if (hasMatch) {
          if (!s.ftsTable) {
            throw new UnsupportedFeatureError('full-text search', 'sqlite');
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
            if (p.kind === 'match') {
              const colName = p.col.slice(p.col.lastIndexOf('.') + 1);
              params.push(escapeFts5Term(p.value as string));
              return `${ftsRef}.${quoteIdentifier(d, colName)} MATCH ?`;
            }
            params.push(p.value);
            return `${quoteColumn(d, p.col)} ${p.op} ?`;
          });
          text += ` WHERE ${parts.join(' AND ')}`;
        }
      } else {
        text = `SELECT * FROM ${quoteTable(d, s.table)}`;
        if (s.preds.length > 0) {
          const parts = s.preds.map(p => {
            params.push(p.value);
            if (p.kind === 'match') {
              if (d === 'postgres') {
                return `to_tsvector('english', ${quoteColumn(d, p.col)}) @@ to_tsquery('english', $${params.length})`;
              }
              // mysql
              return `MATCH(${quoteColumn(d, p.col)}) AGAINST(? IN NATURAL LANGUAGE MODE)`;
            }
            const ph = d === 'postgres' ? `$${params.length}` : '?';
            return `${quoteColumn(d, p.col)} ${p.op} ${ph}`;
          });
          text += ` WHERE ${parts.join(' AND ')}`;
        }
      }

      if (s.limitN !== undefined) text += ` LIMIT ${s.limitN}`;
      if (s.offsetN !== undefined) text += ` OFFSET ${s.offsetN}`;
      return Object.freeze({ text, parameters: Object.freeze(params) });
    },
  };
}

export function ftsSelectFrom(
  table: string,
  dialect: Dialect = 'postgres',
  options?: FtsOptions | string | boolean,
): FtsSelect {
  const ftsTable = typeof options === 'string' || typeof options === 'boolean' ? options : options?.ftsTable;
  return make(dialect, { table, preds: [], ftsTable });
}
