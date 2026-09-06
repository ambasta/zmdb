// @zmdb/web — typed request context + compile-time path-param derivation
// (epic #257, spec ./SPEC.md). Pure types + one small runtime helper. No `as`,
// no reflection.

import type { Span } from '@zmdb/app/observability';

/**
 * Derive a params object from a route path string. Each `:name` segment becomes
 * a required `string` property. Static paths yield an empty object type.
 *
 * PathParams<'/users/:id/posts/:postId'> = { id: string; postId: string }
 */
export type PathParams<Path extends string> = Path extends `${string}:${infer Param}/${infer Rest}`
  ? { [K in Param | keyof PathParams<`/${Rest}`>]: string }
  : Path extends `${string}:${infer Param}`
    ? { [K in Param]: string }
    : Record<never, string>;

/** Query string values: a single string or a repeated-key array. */
export type QueryValues = Record<string, string | readonly string[]>;

/**
 * The single argument a handler receives. Stage 3 has no parameter decorators,
 * so params/body/query/headers arrive on one strongly-typed context object.
 */
export interface Ctx<
  Params extends Record<string, string> = Record<never, string>,
  Body = unknown,
  Query extends QueryValues = Record<never, string>,
> {
  readonly params: Params;
  readonly body: Body;
  readonly query: Query;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: string;
  readonly path: string;
  readonly span?: Span;
}

/**
 * A handler signature bound to a route path: `ctx.params` is exactly
 * `PathParams<Path>`, so reading an undeclared param is a compile error and no
 * `as` is ever needed to type params.
 */
export type HandlerFor<
  Path extends string,
  Body = unknown,
  Query extends QueryValues = Record<never, string>,
  Result = unknown,
> = (ctx: Ctx<PathParams<Path>, Body, Query>) => Result | Promise<Result>;

// A route pattern is a compile-time constant, but the path it is matched against
// is not. Splitting the *pattern* per request — which is what a `split`-based
// matcher does — re-derives a known answer on every call, and the intermediate
// arrays are garbage the collector then has to chase. So patterns are resolved
// once, at registration, into the shape below, and matching walks the request
// path by character index rather than materializing it as an array.

const SLASH = 47; // '/'
const COLON = 58; // ':'

/**
 * A route pattern with its `:param` slots resolved. Build one per route at
 * registration time with {@link compilePattern} and match many requests against
 * it with {@link matchCompiled}.
 */
export interface CompiledPattern {
  /** The pattern this was built from, for diagnostics. */
  readonly pattern: string;
  /** Non-empty segment count — the bucket a request path must share to match. */
  readonly segmentCount: number;
  /** Static text per segment; `null` marks a `:param` slot. */
  readonly literals: readonly (string | null)[];
  /** Param names in slot order, parallel to the `null`s in {@link literals}. */
  readonly names: readonly string[];
}

// A match against a pattern with no params has no per-request state, so every
// such match can share one object. It is frozen because sharing a mutable one
// would let a handler's write leak into unrelated requests; `Ctx.params` is
// declared `readonly`, so freezing only makes the runtime agree with the types.
const EMPTY_PARAMS: Record<string, string> = Object.freeze({});

/** Resolve a route pattern's segments and `:param` slots. Call once per route. */
export function compilePattern(pattern: string): CompiledPattern {
  const literals: (string | null)[] = [];
  const names: string[] = [];
  for (const segment of pattern.split('/')) {
    if (segment.length === 0) continue;
    if (segment.charCodeAt(0) === COLON) {
      literals.push(null);
      names.push(segment.slice(1));
    } else {
      literals.push(segment);
    }
  }
  return { pattern, segmentCount: literals.length, literals, names };
}

/** Count a path's non-empty segments, so leading/trailing slashes don't count. */
export function countSegments(path: string): number {
  let count = 0;
  let i = 0;
  while (i < path.length) {
    while (i < path.length && path.charCodeAt(i) === SLASH) i += 1;
    if (i >= path.length) break;
    count += 1;
    while (i < path.length && path.charCodeAt(i) !== SLASH) i += 1;
  }
  return count;
}

/**
 * Match a concrete `path` against an already-{@link compilePattern}ed route.
 * Returns the params on a match, or `undefined` on a segment-count or static
 * mismatch. A pattern with no params allocates nothing and yields a shared
 * frozen empty object; one with params allocates the params object and one
 * string per param, and nothing else.
 */
export function matchCompiled(compiled: CompiledPattern, path: string): Record<string, string> | undefined {
  const { literals, names, segmentCount } = compiled;
  let params: Record<string, string> | undefined;
  let segment = 0;
  let nameIndex = 0;
  let i = 0;

  while (i < path.length) {
    while (i < path.length && path.charCodeAt(i) === SLASH) i += 1;
    if (i >= path.length) break;
    if (segment === segmentCount) return undefined; // path is longer

    let end = path.indexOf('/', i);
    if (end === -1) end = path.length;

    const literal = literals[segment];
    // `segment < segmentCount` and `segmentCount === literals.length`, so the
    // index is always in range and `undefined` is unreachable — only `null`, the
    // param marker, actually reaches this branch. `names[nameIndex]` is likewise
    // present: `compilePattern` pushed one name per `null` in `literals`, and
    // this walk visits them in that same order.
    if (literal === null || literal === undefined) {
      params ??= {};
      params[names[nameIndex] ?? ''] = path.slice(i, end);
      nameIndex += 1;
    } else if (!literalMatches(literal, path, i, end)) {
      return undefined;
    }

    segment += 1;
    i = end;
  }

  if (segment !== segmentCount) return undefined; // path is shorter
  return params ?? EMPTY_PARAMS;
}

// Compare a static segment against path[from, to) without slicing out a
// substring just to throw it away.
function literalMatches(literal: string, path: string, from: number, to: number): boolean {
  if (literal.length !== to - from) return false;
  for (let k = 0; k < literal.length; k += 1) {
    if (literal.charCodeAt(k) !== path.charCodeAt(from + k)) return false;
  }
  return true;
}

/**
 * Match a concrete `path` against a route `pattern` and extract its params.
 * Returns the params record on a match (a shared frozen empty object when the
 * pattern has no params), or `undefined` when the segment counts differ or a
 * static segment mismatches.
 *
 * This compiles `pattern` on every call, which is the right trade only for
 * one-off matches. A dispatcher matching many requests against a fixed route
 * table should hoist {@link compilePattern} to registration and call
 * {@link matchCompiled} per request — see `../pipeline`.
 */
export function extractParams(pattern: string, path: string): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  let patternPos = 0;
  let pathPos = 0;

  while (true) {
    const patternSeg = nextSegmentRange(pattern, patternPos);
    const pathSeg = nextSegmentRange(path, pathPos);

    if (patternSeg === undefined) {
      if (pathSeg === undefined) {
        return params;
      }
      return undefined;
    }

    const pSegStr = pattern.substring(patternSeg.start, patternSeg.end);

    // Wildcard segment match (*, *name, or :name*)
    if (pSegStr.startsWith('*') || (pSegStr.startsWith(':') && pSegStr.endsWith('*'))) {
      let wildcardName = '*';
      if (pSegStr.startsWith('*')) {
        wildcardName = pSegStr.slice(1);
        if (wildcardName.length === 0) {
          wildcardName = '*';
        }
      } else {
        wildcardName = pSegStr.slice(1, -1);
      }
      if (pathSeg === undefined) {
        params[wildcardName] = '';
      } else {
        params[wildcardName] = path.substring(pathSeg.start);
      }
      return params;
    }

    if (pathSeg === undefined) {
      return undefined;
    }

    const pathSegStr = path.substring(pathSeg.start, pathSeg.end);

    if (pSegStr.startsWith(':')) {
      const paramName = pSegStr.slice(1);
      params[paramName] = pathSegStr;
    } else if (pSegStr !== pathSegStr) {
      return undefined;
    }

    patternPos = patternSeg.end;
    pathPos = pathSeg.end;
  }
}

// Find the start and end indices of the next non-empty segment in a path.
function nextSegmentRange(str: string, pos: number): { start: number; end: number } | undefined {
  let start = pos;
  while (start < str.length && str.charCodeAt(start) === 47 /* '/' */) {
    start += 1;
  }
  if (start >= str.length) {
    return undefined;
  }
  let end = str.indexOf('/', start);
  if (end === -1) {
    end = str.length;
  }
  return { start, end };
}
