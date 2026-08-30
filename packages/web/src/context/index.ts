// @zmdb/web — typed request context + compile-time path-param derivation
// (epic #257, spec ./SPEC.md). Pure types + one small runtime helper. No `as`,
// no reflection.

/**
 * Derive a params object from a route path string. Each `:name` segment becomes
 * a required `string` property. Static paths yield an empty object type.
 *
 * PathParams<'/users/:id/posts/:postId'> = { id: string; postId: string }
 */
export type PathParams<Path extends string> =
  Path extends `${string}:${infer Param}/${infer Rest}`
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

/**
 * Match a concrete `path` against a route `pattern` and extract its params.
 * Returns the params record on a match (empty object when the pattern has no
 * params), or `undefined` when the segment counts differ or a static segment
 * mismatches. Pure; allocates one params object.
 */
export function extractParams(pattern: string, path: string): Record<string, string> | undefined {
  const patternSegments = splitSegments(pattern);
  const pathSegments = splitSegments(path);
  if (patternSegments.length !== pathSegments.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i += 1) {
    const patternSegment = patternSegments[i];
    const pathSegment = pathSegments[i];
    if (patternSegment === undefined || pathSegment === undefined) {
      return undefined;
    }
    if (patternSegment.startsWith(':')) {
      params[patternSegment.slice(1)] = pathSegment;
    } else if (patternSegment !== pathSegment) {
      return undefined;
    }
  }
  return params;
}

// Split a path into non-empty segments (so leading/trailing slashes don't
// produce empty entries).
function splitSegments(path: string): readonly string[] {
  return path.split('/').filter((segment) => segment.length > 0);
}
