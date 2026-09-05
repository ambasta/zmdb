/** A command-line contract error rather than a failed schema operation. */
export class CliInvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliInvocationError';
  }
}
