/** A stable diagnostic returned by project compilation. */
export interface CompilerDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly file?: string;
}
