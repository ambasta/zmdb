import { validationIssuesOf, type ValidationIssue } from '@zmdb/schema-core';

export interface InvocableTool<T> {
  readonly validate: (args: unknown) => T;
  readonly handler: (input: T, identity?: unknown) => unknown | PromiseLike<unknown>;
}

export type ToolInvocation =
  | { readonly kind: 'success'; readonly content: string }
  | { readonly kind: 'validation-error'; readonly error: unknown; readonly content?: string }
  | { readonly kind: 'handler-error'; readonly error: unknown };

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

export const serialiseToolResult = (result: unknown): string => {
  if (typeof result === 'string') return result;
  const serialised = JSON.stringify(result);
  return serialised ?? 'undefined';
};

const validationErrorContent = (error: unknown): string | undefined => {
  const issues = validationIssuesOf(error);
  if (issues === undefined) return undefined;
  return JSON.stringify(
    issues.map(issue =>
      issue.expected === undefined
        ? { path: issue.path, message: issue.message }
        : { path: issue.path, message: issue.message, expected: issue.expected },
    ),
  );
};

export async function invokeTool<T>(
  entry: InvocableTool<T>,
  args: unknown,
  identity?: unknown,
): Promise<ToolInvocation> {
  let input: T;
  try {
    input = entry.validate(args);
  } catch (error) {
    const content = validationErrorContent(error);
    return content === undefined ? { kind: 'validation-error', error } : { kind: 'validation-error', error, content };
  }

  try {
    return { kind: 'success', content: serialiseToolResult(await entry.handler(input, identity)) };
  } catch (error) {
    return { kind: 'handler-error', error };
  }
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
