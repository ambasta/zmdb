/** A command-line contract error rather than a failed schema operation. */
export class CliInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInvocationError';
  }
}

/** Preserve the original failure before an error raised while disposing its resources. */
export function errorMessage(error: unknown): string {
  if (
    (typeof SuppressedError !== 'undefined' && error instanceof SuppressedError) ||
    (error instanceof Error && 'suppressed' in error && 'error' in error)
  ) {
    return `${errorMessage(error.suppressed)}\ncleanup: ${errorMessage(error.error)}`;
  }
  if (error instanceof AggregateError) {
    const errors: readonly unknown[] = error.errors;
    if (errors.length > 0) return errors.map(errorMessage).join('\ncleanup: ');
  }
  return error instanceof Error ? error.message : String(error);
}

export function makeSuppressedError(cleanupError: unknown, cause: unknown, message: string): Error {
  if (typeof SuppressedError !== 'undefined') {
    return new SuppressedError(cleanupError, cause, message);
  }
  const err = new Error(message, { cause });
  Reflect.set(err, 'suppressed', cleanupError);
  Reflect.set(err, 'error', cause);
  return err;
}
