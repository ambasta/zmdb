/** An error carrying an HTTP status, thrown when a middleware chain short-circuits. */
export class ChainError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ChainError';
    this.status = status;
  }
}

/**
 * Internal boundary error whose status is already the framework's decision.
 *
 * Ordinary user-thrown pipe errors still become ChainError(400). Built-in
 * boundary parsers use this subclass when 400 and 413 have distinct meanings.
 */
export class BoundaryStatusError extends ChainError {}
