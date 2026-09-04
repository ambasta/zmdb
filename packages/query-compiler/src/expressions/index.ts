import { TRAITS, type Dialect } from '../dialects/index.js';
import { formatPlaceholder, quoteIdentifier } from '../quoting.js';

/** Runtime brand for compiler-owned column expressions. */
export const EXPR: unique symbol = Symbol('zmdb.column-expression');
const PHANTOM: unique symbol = Symbol('zmdb.column-expression.phantom');

type ExpressionBrand<T> = {
  readonly [EXPR]: true;
  readonly [PHANTOM]?: T;
};

/** A deliberately closed expression over the column named by its SET key. */
export type ColumnExpr<T> = ExpressionBrand<T> &
  (
    | { readonly op: 'add' | 'sub' | 'mul'; readonly by: T }
    | { readonly op: 'not' }
    | { readonly op: 'concat'; readonly with: string }
    | { readonly op: 'coalesce'; readonly fallback: T }
    | { readonly op: 'proposed' }
  );

/** A literal value or a compiler-owned expression for the same column type. */
export type SetValue<T> = T | ColumnExpr<T>;

function brand<T>(expression: ColumnExpr<T>): ColumnExpr<T> {
  Object.defineProperty(expression, EXPR, {
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return expression;
}

export function inc<T extends number | bigint>(by?: T): ColumnExpr<T>;
export function inc(by: number | bigint = 1): ColumnExpr<number | bigint> {
  return brand<number | bigint>({ [EXPR]: true, op: 'add', by });
}

export function dec<T extends number | bigint>(by?: T): ColumnExpr<T>;
export function dec(by: number | bigint = 1): ColumnExpr<number | bigint> {
  return brand<number | bigint>({ [EXPR]: true, op: 'sub', by });
}

export function mul<T extends number>(by: T): ColumnExpr<T> {
  return brand<T>({ [EXPR]: true, op: 'mul', by });
}

export function not(): ColumnExpr<boolean> {
  return brand<boolean>({ [EXPR]: true, op: 'not' });
}

export function concat(withText: string): ColumnExpr<string> {
  return brand<string>({ [EXPR]: true, op: 'concat', with: withText });
}

export function coalesce<T>(fallback: T): ColumnExpr<T> {
  return brand<T>({ [EXPR]: true, op: 'coalesce', fallback });
}

export function proposed<T>(): ColumnExpr<T> {
  return brand<T>({ [EXPR]: true, op: 'proposed' });
}

export function isColumnExpr(value: unknown): value is ColumnExpr<unknown> {
  return typeof value === 'object' && value !== null && EXPR in value;
}

interface EmittedExpr {
  readonly sql: string;
  readonly params: readonly unknown[];
}

interface EmitColumnExprOptions {
  readonly dialect: Dialect;
  readonly table: string;
  readonly column: string;
  readonly parameterIndex: number;
  readonly scope: 'update' | 'upsert';
}

/** Emit one expression and only the parameters contributed by that expression. */
export function emitColumnExpr(expression: ColumnExpr<unknown>, options: EmitColumnExprOptions): EmittedExpr {
  const { dialect, table, column, parameterIndex, scope } = options;
  const traits = TRAITS[dialect];
  const quotedColumn = quoteIdentifier(dialect, column);
  const placeholder = formatPlaceholder(dialect, parameterIndex);

  switch (expression.op) {
    case 'add':
      return { sql: `${quotedColumn} + ${placeholder}`, params: [expression.by] };
    case 'sub':
      return { sql: `${quotedColumn} - ${placeholder}`, params: [expression.by] };
    case 'mul':
      return { sql: `${quotedColumn} * ${placeholder}`, params: [expression.by] };
    case 'not':
      return {
        sql: traits.booleanNot === 'not' ? `NOT ${quotedColumn}` : `~${quotedColumn}`,
        params: [],
      };
    case 'concat':
      return {
        sql:
          traits.concat === 'function'
            ? `CONCAT(${quotedColumn}, ${placeholder})`
            : `${quotedColumn} || ${placeholder}`,
        params: [expression.with],
      };
    case 'coalesce':
      return { sql: `COALESCE(${quotedColumn}, ${placeholder})`, params: [expression.fallback] };
    case 'proposed':
      if (scope !== 'upsert') {
        throw new Error(
          `proposed() references the row being inserted and is only valid inside onConflict().doUpdate() ` +
            `(${JSON.stringify(column)} on ${JSON.stringify(table)})`,
        );
      }
      return {
        sql: traits.upsert === 'onDuplicateKey' ? `VALUES(${quotedColumn})` : `EXCLUDED.${quotedColumn}`,
        params: [],
      };
  }
}
