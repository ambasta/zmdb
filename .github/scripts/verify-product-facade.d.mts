export interface FacadeItem {
  readonly name: string;
  readonly owner?: string;
}

export interface FacadeOwnership {
  readonly root: readonly FacadeItem[];
  readonly subpaths: readonly FacadeItem[];
}

export interface ProductFacadeReport {
  readonly processProblems: readonly string[];
  readonly runtimeNames: readonly string[];
  readonly typeNames: readonly string[];
  readonly subpaths: readonly string[];
  readonly missingSubpaths: readonly string[];
  readonly forbiddenImports: readonly string[];
  readonly ownership: FacadeOwnership;
}

export interface PackedConsumerResult {
  readonly stage: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export const ROOT: string;
export const TARGET_ROOT_VALUES: readonly string[];
export const TARGET_ROOT_TYPES: readonly string[];
export const REQUIRED_PRODUCT_SUBPATHS: readonly string[];

export function readFacadeOwnership(root?: string): FacadeOwnership;
export function inspectProductFacade(root?: string): ProductFacadeReport;
export function inspectProductConsumerFixture(fixture: string): readonly string[];
export function runPackedProductConsumer(root?: string, fixture?: string): PackedConsumerResult;
