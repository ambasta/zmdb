import {
  PRIMARY_READ_EFFECTS,
  READ_EFFECTS,
  UNKNOWN_ROW_EFFECTS,
  UNKNOWN_WRITE_EFFECTS,
  writeEffects,
  type QueryEffects,
  type QueryMetadata,
} from './compiled-query.js';
// Clause rendering shared by every builder in this package.
//
// SELECT, the join builder, the aggregate builder, FTS, UPDATE and DELETE all
// have to turn the same three things into SQL: a predicate list, a join list,
// and the ORDER BY / LIMIT / OFFSET tail. Each builder used to carry its own
// copy, and the copies had drifted: the aggregate builder's `having` understood
// a subquery but its `where` pushed the builder object into the parameter list
// as if it were a value, and three of them reimplemented `renumberPlaceholders`
// inline rather than importing the one in ./quoting.ts.
//
// Everything here appends its own leading space and returns '' when it has
// nothing to render, so callers concatenate unconditionally.
import { dialectName, dialectTraits, type DialectTarget } from './dialects/index.js';
import { UnsupportedFeatureError } from './errors.js';
import {
  DISTANCE_OPERATORS,
  encodePgVector,
  isDistanceOp,
  renderSpatialPredicate,
  type SpatialPredicateNode,
} from './extensions/index.js';
import { type CompiledQuery, type QueryTelemetry } from './index.js';

/** One compile traversal accumulates nested primary requirements alongside parameters. */
export interface EffectState {
  requiresPrimary: boolean;
}
import {
  formatPlaceholder,
  qualifyRootColumn,
  quoteColumn,
  quoteTable,
  renumberPlaceholders,
  unaliasedTable,
} from './quoting.js';

export type JoinKind = 'inner' | 'left' | 'right';

export interface JoinCondition {
  readonly leftCol: string;
  readonly rightCol: string;
}

export interface JoinSpec {
  readonly kind: JoinKind;
  readonly target: string;
  readonly conditions: readonly JoinCondition[];
  /** Predicates that belong to this target and therefore stay in the ON clause. */
  readonly on?: readonly Predicate[];
}

/**
 * One comparison in a WHERE or HAVING list. `connector` says how it attaches to
 * the predicate before it and is ignored on the first one; builders that only
 * ever conjoin can leave it out.
 */
export interface ComparisonPredicate {
  readonly kind?: 'comparison';
  readonly col: string;
  readonly op: string;
  readonly value: unknown;
  readonly connector?: 'AND' | 'OR' | undefined;
}

/** One parenthesized predicate list, attached to the surrounding list by `connector`. */
export interface PredicateGroup {
  readonly kind: 'group';
  readonly predicates: readonly Predicate[];
  readonly connector?: 'AND' | 'OR' | undefined;
}

export interface MatchPredicate {
  readonly kind: 'match';
  readonly col: string;
  readonly value: string;
  readonly connector?: 'AND' | 'OR' | undefined;
}

export type Predicate = ComparisonPredicate | SpatialPredicateNode | PredicateGroup;
export type RenderPredicate = Predicate | MatchPredicate;

/** Quote a literal FTS5 phrase, including embedded quotes. */
export function escapeFts5Term(term: unknown): string {
  return `"${String(term).replace(/"/g, '""')}"`;
}

export interface Tail<C = string> {
  readonly orderBys?: readonly { readonly col: C; readonly dir: 'asc' | 'desc' }[] | undefined;
  readonly limitN?: number | undefined;
  readonly offsetN?: number | undefined;
  /** Used by builders that render a richer ORDER BY expression before delegating pagination. */
  readonly ordered?: boolean | undefined;
}

const JOIN_KEYWORD: Record<JoinKind, string> = {
  inner: 'INNER JOIN',
  left: 'LEFT JOIN',
  right: 'RIGHT JOIN',
};

// Object.create(null) prevents prototype inheritance so an operator named 'constructor' cannot resolve through Object.prototype.
export const OP_MAP: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null), {
    '=': '=',
    '!=': '!=',
    '<': '<',
    '<=': '<=',
    '>': '>',
    '>=': '>=',
    like: 'LIKE',
    ilike: 'ILIKE',
    in: 'IN',
    'not in': 'NOT IN',
    nin: 'NOT IN',
    exists: 'EXISTS',
    'not exists': 'NOT EXISTS',
    'is null': 'IS NULL',
    'is not null': 'IS NOT NULL',
    ...DISTANCE_OPERATORS,
  }),
);

/**
 * The lexical shape of an operator the compiler does not know by name.
 *
 * This is deliberately not a dialect/operator allowlist: PostgreSQL extensions,
 * SQLite GLOB, MySQL's null-safe equality and SQL Server's !< all remain usable.
 * It is only the boundary between one SQL token and caller-controlled SQL text.
 *
 * `--` is excluded even though `-` is needed by real operators such as `->>`.
 * `#` is restricted to PostgreSQL's `#>` / `#>>`; a bare hash starts a MySQL
 * line comment. Placeholder markers are excluded on the dialects where they
 * would be parsed as parameters. Slash is absent, so block-comment openers
 * cannot be formed.
 */
function isUnmappedOperatorToken(op: string, dialect: DialectTarget): boolean {
  return dialectTraits(dialect).acceptsOperator(op);
}

/**
 * Anything with a `compile()` — a builder from this package, or a caller's own.
 *
 * boundary: the cast is inside the guard that the rest of the package relies on, and it
 * reads the one property the `in` check on the line above has just proven is there. Its
 * type is `unknown`, so the `typeof` is what establishes anything; a narrower cast would be
 * the claim this function exists to test.
 */
export function isSubqueryTarget(value: unknown): value is { compile(): CompiledQuery } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'compile' in value &&
    typeof (value as { compile?: unknown }).compile === 'function'
  );
}

/**
 * Normalizes known operators to canonical SQL keywords and admits an unmapped
 * operator only when it is one bounded SQL token.
 */
export function sqlOperator(op: string, dialect: DialectTarget): string {
  const normalized = op.toLowerCase().trim();
  if (isDistanceOp(normalized) && !dialectTraits(dialect).vectorDistance) {
    throw new UnsupportedFeatureError(normalized, dialectName(dialect));
  }
  // A plain index read, and no own-property guard: `OP_MAP` has a null prototype, so
  // `OP_MAP['constructor']` is already `undefined` rather than a function off
  // `Object.prototype`. That is what makes `??` safe here, and it is why the map is built
  // the way it is.
  const mapped = OP_MAP[normalized];
  if (mapped !== undefined) return mapped;
  if (!isUnmappedOperatorToken(op, dialect)) {
    const name = dialectName(dialect);
    throw new TypeError(
      `invalid unmapped SQL operator ${JSON.stringify(op)} for dialect ${JSON.stringify(name)}; expected ` +
        'one non-comment operator token that does not conflict with the dialect placeholder syntax',
    );
  }
  return op;
}

/** `col op $n`, or `EXISTS (…)` / `col op (…)` when the value is a subquery. */
export function renderPredicate(
  dialect: DialectTarget,
  p: RenderPredicate,
  params: unknown[],
  expressions?: ReadonlyMap<string, string>,
  rootReference?: string,
  effects?: EffectState,
): string {
  if (p.kind === 'group') {
    if (p.predicates.length === 0) throw new TypeError('predicate groups must not be empty');
    return `(${predicateList(dialect, p.predicates, params, expressions, rootReference, effects)})`;
  }
  if (p.kind === 'spatial')
    return renderSpatialPredicate(
      dialect,
      rootReference === undefined ? p : { ...p, col: qualifyRootColumn(p.col, rootReference) },
      params,
    );
  if (p.kind === 'match') {
    const fts = dialectTraits(dialect).fts;
    params.push(fts === 'companionTable' ? escapeFts5Term(p.value) : p.value);
    const placeholder = formatPlaceholder(dialect, params.length);
    const column = quoteColumn(dialect, qualifyRootColumn(p.col, rootReference));
    if (fts === 'companionTable') return `${column} MATCH ${placeholder}`;
    if (fts === 'tsvector') return `to_tsvector('english', ${column}) @@ to_tsquery('english', ${placeholder})`;
    if (fts === 'match') return `MATCH(${column}) AGAINST(${placeholder} IN NATURAL LANGUAGE MODE)`;
    if (fts === 'matchPlain') return `MATCH(${column}) AGAINST(${placeholder})`;
    throw new UnsupportedFeatureError('full-text search', dialectName(dialect));
  }
  const column = expressions?.get(p.col) ?? quoteColumn(dialect, qualifyRootColumn(p.col, rootReference));
  const normalized = p.op.toLowerCase().trim();
  const sqlOp = sqlOperator(p.op, dialect);

  if (sqlOp === 'IS NULL' || sqlOp === 'IS NOT NULL') {
    return `${column} ${sqlOp}`;
  }

  if (isDistanceOp(normalized)) {
    params.push(encodePgVector(p.value));
    return `${column} ${sqlOp} ${formatPlaceholder(dialect, params.length)}`;
  }

  if (sqlOp === 'IS NULL' || sqlOp === 'IS NOT NULL') {
    return `${column} ${sqlOp}`;
  }

  if (isSubqueryTarget(p.value)) {
    const sub = p.value.compile();
    if (sub.effects.requiresPrimary && effects !== undefined) effects.requiresPrimary = true;
    // Continue the outer statement's numbering. Positional placeholders are a
    // no-op here, so the order of the pushes below is what matters.
    const text = renumberPlaceholders(sub.text, params.length, dialect);
    params.push(...sub.parameters);

    if (sqlOp === 'EXISTS') return `EXISTS (${text})`;
    if (sqlOp === 'NOT EXISTS') return `NOT EXISTS (${text})`;
    return `${column} ${sqlOp} (${text})`;
  }

  if (sqlOp === 'IN' || sqlOp === 'NOT IN') {
    const isNotIn = sqlOp === 'NOT IN';
    let arr = Array.isArray(p.value) ? p.value : [p.value];
    if (isNotIn) {
      arr = arr.filter(item => item !== null && item !== undefined);
    }
    if (arr.length === 0) {
      return isNotIn ? '1 = 1' : '1 = 0';
    }
    const placeholders = arr
      .map(item => {
        params.push(item);
        return formatPlaceholder(dialect, params.length);
      })
      .join(', ');
    return `${column} ${sqlOp} (${placeholders})`;
  }

  params.push(p.value);
  return `${column} ${sqlOp} ${formatPlaceholder(dialect, params.length)}`;
}

function predicateList(
  dialect: DialectTarget,
  preds: readonly RenderPredicate[],
  params: unknown[],
  expressions?: ReadonlyMap<string, string>,
  rootReference?: string,
  effects?: EffectState,
): string {
  return preds
    .map((p, i) => {
      const cond = renderPredicate(dialect, p, params, expressions, rootReference, effects);
      return i === 0 ? cond : `${p.connector ?? 'AND'} ${cond}`;
    })
    .join(' ');
}

/** ` WHERE …`, appending each predicate's parameters to `params` in order. */
export function whereClause(
  dialect: DialectTarget,
  preds: readonly RenderPredicate[],
  params: unknown[],
  rootReference?: string,
  effects?: EffectState,
): string {
  if (preds.length === 0) return '';
  return ` WHERE ${predicateList(dialect, preds, params, undefined, rootReference, effects)}`;
}

/** ` HAVING …` — same rendering as WHERE, which is why they share a code path. */
export function havingClause(
  dialect: DialectTarget,
  preds: readonly RenderPredicate[],
  params: unknown[],
  expressions?: ReadonlyMap<string, string>,
  rootReference?: string,
  effects?: EffectState,
): string {
  if (preds.length === 0) return '';
  return ` HAVING ${predicateList(dialect, preds, params, expressions, rootReference, effects)}`;
}

/** ` INNER JOIN … ON … = … [AND … = …] [AND …]` for each join, in order. */
export function joinClauses(
  dialect: DialectTarget,
  joins: readonly JoinSpec[],
  params: unknown[] = [],
  rootReference?: string,
  effects?: EffectState,
): string {
  return joins
    .map(j => {
      const conditions = j.conditions
        .map(
          condition =>
            `${quoteColumn(dialect, qualifyRootColumn(condition.leftCol, rootReference))} = ${quoteColumn(dialect, qualifyRootColumn(condition.rightCol, rootReference))}`,
        )
        .join(' AND ');
      const targetPredicates =
        j.on === undefined || j.on.length === 0
          ? ''
          : j.on
              .map((predicate, index) => {
                const rendered = renderPredicate(dialect, predicate, params, undefined, rootReference, effects);
                return `${index === 0 ? 'AND' : (predicate.connector ?? 'AND')} ${rendered}`;
              })
              .join(' ');
      return (
        ` ${JOIN_KEYWORD[j.kind]} ${quoteTable(dialect, j.target)} ` +
        `ON ${conditions}` +
        (targetPredicates.length === 0 ? '' : ` ${targetPredicates}`)
      );
    })
    .join('');
}

/**
 * ` ORDER BY … LIMIT n OFFSET n`. LIMIT and OFFSET are interpolated rather than
 * parameterized because they are numbers this package produced, never caller
 * strings — the builders' `limit`/`offset` take `number`.
 */
export function tailClause(dialect: DialectTarget, tail: Tail): string {
  let text = '';
  const rendersOrderBy = tail.orderBys !== undefined && tail.orderBys.length > 0;
  const ordered = tail.ordered ?? rendersOrderBy;
  if (rendersOrderBy) {
    const ob = tail.orderBys.map(o => `${quoteColumn(dialect, o.col)} ${o.dir.toUpperCase()}`).join(', ');
    text += ` ORDER BY ${ob}`;
  }
  text += dialectTraits(dialect).paginate({
    ...(tail.limitN === undefined ? {} : { limit: tail.limitN }),
    ...(tail.offsetN === undefined ? {} : { offset: tail.offsetN }),
    ordered,
  });
  return text;
}

/** Analyzes query SQL text to infer fallback operation metadata. */
export function analyzeQuery(text: string): {
  operation: 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other';
  isWrite: boolean;
  returnsRows: boolean;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { operation: 'other', isWrite: false, returnsRows: false };
  }

  // Detect DDL operations
  const isDdl = /\b(CREATE|ALTER|DROP|TRUNCATE|REINDEX|VACUUM)\b/i.test(trimmed);

  // Detect DML writes
  const isDmlWrite = /\b(INSERT|UPDATE|DELETE|M[E]RGE)\b/i.test(trimmed);

  // Detect locking reads (FOR UPDATE, FOR SHARE, etc.)
  const isLockingRead =
    /\bFOR\s+(UPDATE|SHARE|KEY\s+SHARE|NO\s+KEY\s+UPDATE)\b/i.test(trimmed) ||
    /\bLOCK\s+IN\s+SHARE\s+MODE\b/i.test(trimmed);

  const isWrite = isDdl || isDmlWrite || isLockingRead;

  // Detect returning rows
  const hasReturning = /\b(RETURNING|O[U]TPUT)\b/i.test(trimmed);
  const isRowReturningCommand = /\b(SELECT|PRAGMA|EXPLAIN|SHOW)\b/i.test(trimmed);
  const returnsRows = hasReturning || isRowReturningCommand;

  // Determine operation category
  let operation: 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other';
  if (isDdl) {
    operation = 'ddl';
  } else {
    let normalized = trimmed;
    while (true) {
      if (normalized.startsWith('/*')) {
        const endIdx = normalized.indexOf('*/', 2);
        if (endIdx === -1) {
          break;
        }
        normalized = normalized.slice(endIdx + 2).trimStart();
      } else if (normalized.startsWith('--')) {
        const endIdx = normalized.indexOf('\n', 2);
        if (endIdx === -1) {
          normalized = '';
          break;
        }
        normalized = normalized.slice(endIdx + 1).trimStart();
      } else {
        break;
      }
    }
    if (/^\s*SELECT/i.test(normalized)) {
      operation = 'select';
    } else if (/^\s*INSERT/i.test(normalized) || /^\s*M[E]RGE/i.test(normalized)) {
      operation = 'insert';
    } else if (/^\s*UPDATE/i.test(normalized)) {
      operation = 'update';
    } else if (/^\s*DELETE/i.test(normalized)) {
      operation = 'delete';
    } else if (/^\s*WITH\b/i.test(normalized)) {
      if (/\bINSERT\b/i.test(normalized)) operation = 'insert';
      else if (/\bUPDATE\b/i.test(normalized)) operation = 'update';
      else if (/\bDELETE\b/i.test(normalized)) operation = 'delete';
      else operation = 'select';
    } else if (isRowReturningCommand) {
      operation = 'select';
    } else {
      operation = 'other';
    }
  }

  return { operation, isWrite, returnsRows };
}

function isQueryTelemetry(val: unknown): val is QueryTelemetry {
  return typeof val === 'object' && val !== null && 'system' in val;
}

/** Every `compile()` in this package returns this shape, frozen at both levels. */
export function frozenQuery(
  text: string,
  params: readonly unknown[],
function isQueryEffects(val: unknown): val is QueryEffects {
  return (
    typeof val === 'object' &&
    val !== null &&
    ('requiresPrimary' in val ||
      ('operation' in val &&
        typeof (val as any).operation === 'string' &&
        (val as any).operation === (val as any).operation.toUpperCase()))
  );
}

/** Every `compile()` in this package returns this shape, frozen at both levels. */
export function frozenQuery(
  text: string,
  params: readonly unknown[],
  effectsOrMetaOrTelemetry?: QueryEffects | QueryMetadata | QueryTelemetry,
  telemetryArg?: QueryTelemetry,
): CompiledQuery {
  let effects: QueryEffects | undefined;
  let meta: QueryMetadata | undefined;
  let telemetry: QueryTelemetry | undefined = telemetryArg;

  if (isQueryTelemetry(effectsOrMetaOrTelemetry)) {
    telemetry = effectsOrMetaOrTelemetry;
  } else if (isQueryEffects(effectsOrMetaOrTelemetry)) {
    effects = effectsOrMetaOrTelemetry;
  } else if (effectsOrMetaOrTelemetry) {
    meta = effectsOrMetaOrTelemetry as QueryMetadata;
  }

  const inferred = analyzeQuery(text);

  let operation: 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other';
  let isWrite: boolean;
  let returnsRows: boolean;

  if (effects !== undefined) {
    returnsRows = effects.returnsRows;
    if (effects.operation === 'SELECT') {
      operation = 'select';
      isWrite = effects.requiresPrimary || inferred.isWrite;
    } else if (effects.operation === 'INSERT') {
      operation = 'insert';
      isWrite = true;
    } else if (effects.operation === 'UPDATE') {
      operation = 'update';
      isWrite = true;
    } else if (effects.operation === 'DELETE') {
      operation = 'delete';
      isWrite = true;
    } else if (effects.operation === 'DDL') {
      operation = 'ddl';
      isWrite = true;
    } else {
      operation = inferred.operation;
      isWrite = true;
    }
  } else {
    operation = meta?.operation ?? inferred.operation;
    isWrite = meta?.isWrite ?? inferred.isWrite;
    returnsRows = meta?.returnsRows ?? inferred.returnsRows;

    if (operation === 'select' && !isWrite) {
      effects = READ_EFFECTS;
    } else if (operation === 'select' && isWrite) {
      effects = PRIMARY_READ_EFFECTS;
    } else if (operation === 'insert') {
      effects = writeEffects('INSERT', returnsRows);
    } else if (operation === 'update') {
      effects = writeEffects('UPDATE', returnsRows);
    } else if (operation === 'delete') {
      effects = writeEffects('DELETE', returnsRows);
    } else {
      effects = returnsRows ? UNKNOWN_ROW_EFFECTS : UNKNOWN_WRITE_EFFECTS;
    }
  }

  Object.freeze(effects);

  const result: {
    text: string;
    parameters: readonly unknown[];
    effects: QueryEffects;
    operation: 'select' | 'insert' | 'update' | 'delete' | 'ddl' | 'other';
    isWrite: boolean;
    returnsRows: boolean;
    telemetry?: QueryTelemetry;
  } = {
    text,
    parameters: Object.freeze([...params]),
    effects,
    operation,
    isWrite,
    returnsRows,
  };

  if (telemetry !== undefined) {
    result.telemetry = telemetry;
  }

  return Object.freeze(result);
}

/** Compile-known database attributes, absent when telemetry was not requested. */
export function queryTelemetry(
  dialect: DialectTarget,
  operation: QueryTelemetry['operation'],
  collection: string,
  enabled: boolean,
): QueryTelemetry | undefined {
  if (!enabled) return undefined;
  return Object.freeze({
    system: dialect.telemetrySystem,
    operation,
    collection: unaliasedTable(collection),
  });
}
