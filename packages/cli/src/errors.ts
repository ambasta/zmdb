/** A command-line contract error rather than a failed schema operation. */
export class CliInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInvocationError';
  }
}

/** Preserve the original failure before an error raised while disposing its resources. */
export function errorMessage(error: unknown): string {
  if (typeof SuppressedError !== 'undefined' && error instanceof SuppressedError) {
    return `${errorMessage((error as { suppressed?: unknown }).suppressed)}\ncleanup: ${errorMessage((error as { error?: unknown }).error)}`;
  }
  if (error instanceof AggregateError) {
    const errors: readonly unknown[] = error.errors;
    if (errors.length > 0) return errors.map(errorMessage).join('\ncleanup: ');
  }
  return error instanceof Error ? error.message : String(error);
}
