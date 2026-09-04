import { validationIssuesOf, type ValidationIssue } from '../../index.js';

export interface ToolAdapterOptions<T, Output = unknown> {
  readonly description: string;
  /**
   * Validate the model-shaped value and return the decoded application value.
   *
   * This function belongs at the call site so an AOT validator can be inlined
   * there. Custom wire codecs can decode in the same function before the
   * handler receives the value.
   */
  readonly validate: (value: unknown) => T;
  readonly execute: (input: T) => Output | PromiseLike<Output>;
}

const validationLine = (issue: ValidationIssue): string =>
  issue.expected === undefined ? `${issue.path}: ${issue.message}` : `${issue.path}: expected ${issue.expected}`;

const validationFailure = (name: string, issues: readonly ValidationIssue[]): string => {
  const details = issues.length === 0 ? 'validation failed without details' : issues.map(validationLine).join('\n');
  return `Tool "${name}" rejected its arguments:\n${details}`;
};

/**
 * A malformed model call is returned to the model so it can correct the next
 * turn. Errors without a valid issue list, including handler failures, are
 * application failures and remain thrown.
 */
export async function executeToolAdapter<T, Output>(
  name: string,
  value: unknown,
  options: ToolAdapterOptions<T, Output>,
): Promise<Awaited<Output> | string> {
  let input: T;
  try {
    input = options.validate(value);
  } catch (error) {
    const issues = validationIssuesOf(error);
    if (issues === undefined) throw error;
    return validationFailure(name, issues);
  }
  return await options.execute(input);
}
