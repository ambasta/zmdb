export interface CodeBlock {
  filePath: string;
  startLine: number;
  code: string;
  lines: string[];
  blockLang: string;
}

export interface Declaration {
  kind: 'function' | 'interface' | 'type' | 'class';
  name: string;
  line: number;
  rawText: string;
  params?: Array<{ name: string; optional: boolean; type: string }>;
  returnType?: string;
  properties?: Array<{ name: string; optional: boolean; type: string }>;
  type?: string;
  methods?: Array<{
    name: string;
    params: Array<{ name: string; optional: boolean; type: string }>;
    returnType: string;
  }>;
}

export interface HygieneResult {
  success: boolean;
  totalAssertions: number;
  missingBoundariesCount: number;
  nonNullHitsCount: number;
  evalHitsCount: number;
  errors: string[];
}

export interface SpecValidationResult {
  success: boolean;
  errors: string[];
}

export function findSpecFiles(dir: string): string[];
export function findMarkdownFiles(dir: string): string[];
export function extractCodeBlocks(filePath: string): CodeBlock[];
export function normalizeType(typeStr: string | undefined): string;
export function parseDeclarations(code: string, filename?: string, startLine?: number): Declaration[];
export function compareParams(specParams: unknown[], srcParams: unknown[]): string | null;
export function compareProperties(specProps: unknown[], srcProps: unknown[]): string | null;
export function compareClasses(specClass: unknown, srcClass: unknown): string | null;
export function compareTypes(typeA: string, typeB: string): boolean;
export function auditHygiene(packagesDir?: string): HygieneResult;
export function validateAstDrift(packagesDir?: string): {
  errors: Array<{ file: string; line: number; symbol: string; kind: string; message: string }>;
  totalSpecDeclarations: number;
  skippedBlocksCount: number;
};
export function validateSpecs(packagesDir?: string): SpecValidationResult;
