/** A command-line contract error rather than a failed schema operation. */
export class CliInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInvocationError';
  }
}

class SuppressedErrorFallback extends Error {
  readonly suppressed: unknown;
  readonly error: unknown;
  constructor(suppressed: unknown, error: unknown, message?: string) {
    super(message);
    this.name = 'SuppressedError';
    this.suppressed = suppressed;
    this.error = error;
  }
}

export const SuppressedErrorCtor: typeof SuppressedError =
  typeof SuppressedError !== 'undefined'
    ? SuppressedError
    : (SuppressedErrorFallback as unknown as typeof SuppressedError);

/** Preserve the original failure before an error raised while disposing its resources. */
export function errorMessage(error: unknown): string {
  if (error instanceof SuppressedErrorCtor) {
    return `${errorMessage(error.suppressed)}\ncleanup: ${errorMessage(error.error)}`;
  }
  if (error instanceof AggregateError) {
    const errors: readonly unknown[] = error.errors;
    if (errors.length > 0) return errors.map(errorMessage).join('\ncleanup: ');
  }
  return error instanceof Error ? error.message : String(error);
}
