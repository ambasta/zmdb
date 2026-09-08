export interface ProductFacadeReport {
  readonly processProblems: readonly string[];
  readonly runtimeNames: readonly string[];
  readonly subpaths: readonly string[];
  readonly missingSubpaths: readonly string[];
  readonly forbiddenImports: readonly string[];
}

export interface ProductRootImport {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly runtimeNames: readonly string[];
  readonly imports: readonly {
    readonly specifier: string;
    readonly parentURL: string | null;
    readonly url: string;
  }[];
}

export const ROOT: string;
export const TARGET_ROOT_VALUES: readonly string[];
export const REQUIRED_PRODUCT_SUBPATHS: readonly string[];

export function captureProductRootImport(root?: string): ProductRootImport;
export function inspectProductFacade(root?: string): ProductFacadeReport;
