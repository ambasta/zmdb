if (typeof globalThis.SuppressedError === 'undefined') {
  Reflect.set(
    globalThis,
    'SuppressedError',
    class SuppressedError extends Error {
      readonly error: unknown;
      readonly suppressed: unknown;
      constructor(error: unknown, suppressed: unknown, message?: string) {
        super(message);
        this.name = 'SuppressedError';
        this.error = error;
        this.suppressed = suppressed;
      }
    },
  );
}

/** A command-line contract error rather than a failed schema operation. */
export class CliInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInvocationError';
  }
}

/** Preserve the original failure before an error raised while disposing its resources. */
export function errorMessage(error: unknown): string {
  if (error instanceof SuppressedError) {
    return `${errorMessage(error.suppressed)}\ncleanup: ${errorMessage(error.error)}`;
  }
  if (error instanceof AggregateError) {
    const errors: readonly unknown[] = error.errors;
    if (errors.length > 0) return errors.map(errorMessage).join('\ncleanup: ');
  }
  return error instanceof Error ? error.message : String(error);
}
