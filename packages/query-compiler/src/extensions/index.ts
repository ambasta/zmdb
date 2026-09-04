import { UnsupportedFeatureError } from '../errors.js';
import type { Dialect } from '../index.js';
import { formatPlaceholder, quoteColumn, quoteIdentifier } from '../quoting.js';

export type DistanceOp = 'l2' | 'cosine' | 'ip';

export const DISTANCE_OPERATORS = Object.freeze({
  l2: '<->',
  cosine: '<=>',
  ip: '<#>',
} satisfies Record<DistanceOp, string>);

export type SpatialFn = 'st_contains' | 'st_within' | 'st_intersects' | 'st_dwithin';

const SPATIAL_FUNCTIONS = Object.freeze({
  st_contains: 'ST_Contains',
  st_within: 'ST_Within',
  st_intersects: 'ST_Intersects',
  st_dwithin: 'ST_DWithin',
} satisfies Record<SpatialFn, string>);

type ExtensionMarker<Name extends string> = {
  readonly __zmdbExt?: readonly [extension: string, name: Name, args: readonly (string | number)[]];
};

/** Keys whose declared column type carries `Ext<…, Name, …>`. */
export type ExtensionColumnOf<T, Name extends string> = {
  [K in keyof T]-?: NonNullable<T[K]> extends ExtensionMarker<Name> ? (K extends string ? K : never) : never;
}[keyof T];

export type VectorColumnOf<T> = ExtensionColumnOf<T, 'vector'>;
export type GeometryColumnOf<T> = ExtensionColumnOf<T, 'geometry'>;

/** A GeoJSON geometry accepted by `ST_GeomFromGeoJSON`. */
export interface GeoJsonGeometry {
  readonly type: string;
  readonly coordinates: unknown;
}

/** The declared application geometry for one extension-backed column. */
export type GeometryValueOf<T, C extends GeometryColumnOf<T>> =
  NonNullable<T[C]> extends GeoJsonGeometry ? NonNullable<T[C]> : never;

type GeometryArguments<T> = {
  [C in GeometryColumnOf<T>]: readonly [column: C, geometry: GeometryValueOf<T, C>];
}[GeometryColumnOf<T>];

type GeometryDistanceArguments<T> = {
  [C in GeometryColumnOf<T>]: readonly [column: C, geometry: GeometryValueOf<T, C>, distance: number];
}[GeometryColumnOf<T>];

const EXTENSION_EXPRESSION: unique symbol = Symbol('zmdb.extension-expression');

export interface DistanceExpression<C extends string = string> {
  readonly [EXTENSION_EXPRESSION]: 'distance';
  readonly kind: 'distance';
  readonly column: C;
  readonly operator: DistanceOp;
  readonly query: readonly number[];
  as(alias: string): AliasedDistanceExpression<C>;
}

export interface AliasedDistanceExpression<C extends string = string> {
  readonly [EXTENSION_EXPRESSION]: 'aliased-distance';
  readonly kind: 'aliased';
  readonly expression: DistanceExpression<C>;
  readonly alias: string;
}

export interface SpatialPredicate<C extends string = string> {
  readonly [EXTENSION_EXPRESSION]: 'spatial';
  readonly kind: 'spatial';
  readonly fn: 'st_contains' | 'st_dwithin';
  readonly col: C;
  readonly value: GeoJsonGeometry;
  readonly distance?: number;
}

/** Internal closed predicate shape shared with the dialect matrix. */
export interface SpatialPredicateNode {
  readonly kind: 'spatial';
  readonly fn: SpatialFn;
  readonly col: string;
  readonly value: unknown;
  readonly distance?: number;
  readonly connector?: 'AND' | 'OR';
}

function aliasedDistance<C extends string>(
  expression: DistanceExpression<C>,
  alias: string,
): AliasedDistanceExpression<C> {
  const aliased: AliasedDistanceExpression<C> = {
    [EXTENSION_EXPRESSION]: 'aliased-distance',
    kind: 'aliased',
    expression,
    alias,
  };
  return Object.freeze(aliased);
}

/**
 * A pgvector distance expression. Supplying the declaration type makes the column
 * argument the closed set of its `Ext<…, 'vector', …>` properties.
 */
export function distance<T extends object>(
  column: VectorColumnOf<T>,
  operator: DistanceOp,
  query: readonly number[],
): DistanceExpression<VectorColumnOf<T>> {
  if (!Object.hasOwn(DISTANCE_OPERATORS, operator)) {
    throw new TypeError(
      `unknown distance operator ${JSON.stringify(operator)}; expected ${Object.keys(DISTANCE_OPERATORS).join(' | ')}`,
    );
  }

  const expression: DistanceExpression<VectorColumnOf<T>> = {
    [EXTENSION_EXPRESSION]: 'distance',
    kind: 'distance',
    column,
    operator,
    query,
    as: alias => aliasedDistance(expression, alias),
  };
  return Object.freeze(expression);
}

/** A typed `ST_Contains(column, geometry)` predicate. */
export function stContains<T extends object>(
  ...[column, geometry]: GeometryArguments<T>
): SpatialPredicate<GeometryColumnOf<T>> {
  const predicate: SpatialPredicate<GeometryColumnOf<T>> = {
    [EXTENSION_EXPRESSION]: 'spatial',
    kind: 'spatial',
    fn: 'st_contains',
    col: column,
    value: geometry,
  };
  return Object.freeze(predicate);
}

/** A typed `ST_DWithin(column, geometry, distance)` predicate. */
export function stDWithin<T extends object>(
  ...[column, geometry, maxDistance]: GeometryDistanceArguments<T>
): SpatialPredicate<GeometryColumnOf<T>> {
  const predicate: SpatialPredicate<GeometryColumnOf<T>> = {
    [EXTENSION_EXPRESSION]: 'spatial',
    kind: 'spatial',
    fn: 'st_dwithin',
    col: column,
    value: geometry,
    distance: maxDistance,
  };
  return Object.freeze(predicate);
}

/** Encode a numeric vector into pgvector's text input syntax before binding it. */
export function encodePgVector(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('a pgvector query must be a non-empty numeric array');
  }
  for (const component of value) {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new TypeError('a pgvector query may contain only finite numbers');
    }
  }
  return `[${value.join(',')}]`;
}

export function isDistanceExpression(value: unknown): value is DistanceExpression {
  return value !== null && typeof value === 'object' && Reflect.get(value, EXTENSION_EXPRESSION) === 'distance';
}

export function isAliasedDistanceExpression(value: unknown): value is AliasedDistanceExpression {
  return value !== null && typeof value === 'object' && Reflect.get(value, EXTENSION_EXPRESSION) === 'aliased-distance';
}

export function isSpatialPredicate(value: unknown): value is SpatialPredicate {
  return value !== null && typeof value === 'object' && Reflect.get(value, EXTENSION_EXPRESSION) === 'spatial';
}

export function isDistanceOp(operator: string): operator is DistanceOp {
  return Object.hasOwn(DISTANCE_OPERATORS, operator);
}

function requirePostgres(feature: string, dialect: Dialect): void {
  if (dialect !== 'postgres') throw new UnsupportedFeatureError(feature, dialect);
}

/** Render a compiler-owned distance expression and append its bound vector. */
export function renderDistanceExpression(
  dialect: Dialect,
  expression: DistanceExpression,
  parameters: unknown[],
): string {
  requirePostgres(expression.operator, dialect);
  parameters.push(encodePgVector(expression.query));
  return `${quoteColumn(dialect, expression.column)} ${DISTANCE_OPERATORS[expression.operator]} ${formatPlaceholder(
    dialect,
    parameters.length,
  )}`;
}

/** Render a selected distance expression with its compiler-quoted alias. */
export function renderAliasedDistanceExpression(
  dialect: Dialect,
  expression: AliasedDistanceExpression,
  parameters: unknown[],
): string {
  return `${renderDistanceExpression(dialect, expression.expression, parameters)} AS ${quoteIdentifier(
    dialect,
    expression.alias,
  )}`;
}

/** Render one of the closed PostGIS predicate nodes, binding every value operand. */
export function renderSpatialPredicate(
  dialect: Dialect,
  predicate: SpatialPredicateNode,
  parameters: unknown[],
): string {
  if (!Object.hasOwn(SPATIAL_FUNCTIONS, predicate.fn)) {
    throw new TypeError(`unknown spatial predicate ${JSON.stringify(predicate.fn)}`);
  }
  requirePostgres(predicate.fn, dialect);

  parameters.push(predicate.value);
  const geometry = `ST_GeomFromGeoJSON(${formatPlaceholder(dialect, parameters.length)})`;
  const column = quoteColumn(dialect, predicate.col);
  if (predicate.fn !== 'st_dwithin') return `${SPATIAL_FUNCTIONS[predicate.fn]}(${column}, ${geometry})`;

  if (predicate.distance === undefined) throw new TypeError('st_dwithin requires a distance');
  parameters.push(predicate.distance);
  return `ST_DWithin(${column}, ${geometry}, ${formatPlaceholder(dialect, parameters.length)})`;
}
