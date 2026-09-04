import { validationIssuesOf } from '../index.js';

export interface InvocableTool<T> {
  readonly validate: (args: unknown) => T;
  readonly handler: (input: T, identity?: unknown) => unknown | PromiseLike<unknown>;
}

export type ToolInvocation =
  | { readonly kind: 'success'; readonly content: string }
  | { readonly kind: 'validation-error'; readonly error: unknown; readonly content?: string }
  | { readonly kind: 'handler-error'; readonly error: unknown };

export const toolErrorId = (): string =>
  [...globalThis.crypto.getRandomValues(new Uint8Array(4))].map(byte => byte.toString(16).padStart(2, '0')).join('');

export const serialiseToolResult = (result: unknown): string => {
  if (typeof result === 'string') return result;
  const serialised = JSON.stringify(result);
  return serialised ?? 'undefined';
};

export const validationErrorContent = (error: unknown): string | undefined => {
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
