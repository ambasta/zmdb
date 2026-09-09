export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
  readonly expected?: string;
  readonly value?: unknown;
}

/** A validation success carries its proven value; only failure carries issues. */
export type ValidateResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export class ValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(message: string, issues: readonly ValidationIssue[] = []) {
    super(message);
    this.name = 'ValidationError';
    this.issues = issues;
  }
}

/**
 * Whether a thrown value claims to be about validation.
 *
 * Structural rather than `instanceof ValidationError`, because a validator a caller wrote
 * themselves throws its own error type — zod's, io-ts's, or one of their own — and the HTTP
 * adapters that ask this question have no business caring which. Carrying an `issues`
 * property is the claim; {@link validationIssuesOf} decides whether it holds up.
 */
export function claimsValidationIssues(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'issues' in error;
}

/**
 * The issues on a thrown error, or `undefined` if it carries none worth reporting.
 *
 * Every entry is checked rather than asserted. These end up in a 400 body that a client
 * reads, and "it has an `issues` property" is no evidence that the property holds issues —
 * an error whose `issues` was a string used to be serialized into the response as though it
 * were the list. An entry missing a `path` or a `message` is dropped rather than passed on
 * half-formed; a `ValidationError` with an empty list still answers with the empty list,
 * which is what tells a caller "validation, and it declined to say more".
 */
export function validationIssuesOf(error: unknown): readonly ValidationIssue[] | undefined {
  if (error === null || typeof error !== 'object' || !('issues' in error)) return undefined;
  const issues: unknown = error.issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.filter(
    (issue: unknown): issue is ValidationIssue =>
      issue !== null &&
      typeof issue === 'object' &&
      'path' in issue &&
      typeof issue.path === 'string' &&
      'message' in issue &&
      typeof issue.message === 'string',
  );
}
