import type { Architecture } from '../../scripts/architecture/index.mjs';

export const ROOT: string;

export const TARGET_TOOLING_EXPORTS: Readonly<{
  readonly '@zmdb/compiler': readonly [
    '.',
    './config',
    './emit',
    './errors',
    './lint',
    './metro',
    './reflect',
    './testing',
    './transform',
    './unplugin',
  ];
  readonly '@zmdb/migrations': readonly [
    '.',
    './declarations',
    './embedded',
    './files',
    './introspect',
    './introspect/runtime',
    './runner',
    './testing',
  ];
  readonly '@zmdb/cli': readonly ['.'];
}>;

export const TARGET_TOOLING_BIN: Readonly<{
  readonly packageName: '@zmdb/cli';
  readonly command: 'zmdb';
}>;

export const TARGET_PRODUCT_TOOLING_EXPORTS: Readonly<{
  readonly '@zmdb/compiler': readonly ['./compiler', './config'];
  readonly '@zmdb/migrations': readonly ['./migrations'];
  readonly '@zmdb/cli': readonly ['./cli'];
}>;

export const TARGET_TOOLING_MANIFESTS: Readonly<{
  readonly '@zmdb/compiler': Readonly<{
    readonly dependencies: readonly ['@zmdb/aot-validator', '@zmdb/query-compiler', '@zmdb/schema-core'];
    readonly peerDependencies: readonly ['metro', 'metro-babel-transformer', 'oxlint', 'typescript'];
    readonly optionalPeers: readonly ['metro', 'metro-babel-transformer', 'oxlint'];
  }>;
  readonly '@zmdb/migrations': Readonly<{
    readonly dependencies: readonly ['@zmdb/query-compiler', 'oxfmt'];
    readonly peerDependencies: readonly [];
    readonly optionalPeers: readonly [];
  }>;
  readonly '@zmdb/cli': Readonly<{
    readonly dependencies: readonly ['@zmdb/compiler', '@zmdb/migrations', 'oxfmt'];
    readonly peerDependencies: readonly ['@zmdb/web', 'esbuild'];
    readonly optionalPeers: readonly ['@zmdb/web', 'esbuild'];
  }>;
}>;

export const GENERATED_ARTIFACTS: readonly string[];

export interface OwnershipEntry {
  readonly owner: string;
  readonly path: string;
}

export interface ToolingViolation {
  readonly id: string;
  readonly entry?: string;
  readonly category?: string;
  readonly source?: string;
  readonly chain?: readonly string[];
  readonly path?: string;
  readonly specifier?: string;
  readonly reason?: string;
}

export interface ToolingBoundaryResult {
  readonly problems: readonly string[];
  readonly inventory: {
    readonly catalog: readonly OwnershipEntry[];
    readonly ownerCounts: Readonly<Record<string, number>>;
    readonly actualCount: number;
    readonly problems: readonly string[];
  };
  readonly packageGraph: {
    readonly edges: readonly (readonly [string, string])[];
    readonly problems: readonly string[];
  };
  readonly runtimeViolations: readonly ToolingViolation[];
  readonly generatedViolations: readonly ToolingViolation[];
  readonly embeddedViolations: readonly ToolingViolation[];
  readonly formatterViolations: readonly ToolingViolation[];
  readonly binOwners: readonly string[];
}

export function findPackageCycle(edges: readonly (readonly [string, string])[]): readonly string[] | null;
export function parseOwnershipCatalog(source: string): readonly OwnershipEntry[];
export function analyseToolingBoundaries(options: {
  readonly root?: string;
  readonly architecture: Architecture;
  readonly overlays?: ReadonlyMap<string, string>;
}): ToolingBoundaryResult;
