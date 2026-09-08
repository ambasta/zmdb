/** Receipt emitted only after the installed case and its cleanup have completed. */
export interface CompatibilityReceipt {
  readonly caseId: string;
  readonly packageId: string;
  readonly kind: 'supported' | 'below-floor' | 'incompatible-core' | 'independent-integration';
  readonly installed: readonly {
    readonly name: string;
    readonly version: string;
    readonly resolved: string;
    readonly integrity: string;
  }[];
  readonly commands: readonly {
    readonly stage: 'install' | 'lock-reinstall' | 'types' | 'runtime' | 'resolution';
    readonly exitCode: number;
  }[];
  readonly runtime: string;
  readonly packageManager: string;
  readonly expectedRefusal?: {
    readonly owner: string;
    readonly dependency: string;
    readonly range: string;
    readonly selected: string;
    readonly diagnostic: string;
  };
  readonly passed: boolean;
  readonly cleaned: boolean;
}
