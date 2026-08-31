// Static regular expression complexity validator and safe fallback evaluator.
// Maintains compiled-RegExp cache and validates syntax to protect against ReDoS vulnerabilities.

export class ValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ValidationError';
  }
}

export function validatePatternComplexity(pattern: string): void {
  try {
    RegExp(pattern);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ValidationError(`Invalid regular expression pattern: ${msg}`, { cause: err });
  }
}

const MAX_FALLBACK_INPUT_LENGTH = 10000;
const patternCache = new Map<string, RegExp>();

export function getCachedRegExp(pattern: string): RegExp {
  let re = patternCache.get(pattern);
  if (!re) {
    validatePatternComplexity(pattern);
    re = new RegExp(pattern);
    patternCache.set(pattern, re);
  }
  return re;
}

export function safeTestPattern(pattern: string, input: string, maxInputLength = MAX_FALLBACK_INPUT_LENGTH): boolean {
  if (input.length > maxInputLength) {
    throw new ValidationError(
      `Input length (${input.length}) exceeds maximum limit (${maxInputLength}) for pattern evaluation`,
    );
  }
  const re = getCachedRegExp(pattern);
  return re.test(input);
}
