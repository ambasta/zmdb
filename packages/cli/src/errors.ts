/** A command-line contract error rather than a failed schema operation. */
export class CliInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInvocationError';
  }
}

export class PolyfillSuppressedError extends Error {
  readonly error: unknown;
  readonly suppressed: unknown;
  constructor(error: unknown, suppressed: unknown, message?: string) {
    super(message);
    this.name = 'SuppressedError';
    this.error = error;
    this.suppressed = suppressed;
  }
}

export const SuppressedErrorClass = typeof SuppressedError !== 'undefined' ? SuppressedError : PolyfillSuppressedError;

/** Preserve the original failure before an error raised while disposing its resources. */
export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if (
      (typeof SuppressedError !== 'undefined' && error instanceof SuppressedError) ||
      error instanceof PolyfillSuppressedError ||
      ('name' in error && error.name === 'SuppressedError')
    ) {
      const suppressed = 'suppressed' in error ? error.suppressed : undefined;
      const errObj = 'error' in error ? error.error : undefined;
      return `${errorMessage(suppressed)}\ncleanup: ${errorMessage(errObj)}`;
    }
    if (error instanceof AggregateError) {
      const errors: readonly unknown[] = error.errors;
      if (errors.length > 0) return errors.map(errorMessage).join('\ncleanup: ');
    }
  }
  return error instanceof Error ? error.message : String(error);
}
