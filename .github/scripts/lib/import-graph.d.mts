import type { Architecture } from '../../../scripts/architecture/index.mjs';

export type ImportGraphMode = 'ownership' | 'runtime';

export interface ImportGraphReference {
  readonly file: string;
  readonly kind: 'runtime' | 'type';
  readonly packageName?: string;
  readonly specifier: string;
  readonly resolved: string | null;
}

export interface WorkspacePackage {
  readonly dir: string;
  readonly exports: string | Readonly<Record<string, unknown>>;
}

export interface WorkspacePackageInput {
  readonly npmName: string;
  readonly directoryPath: string;
  readonly manifest: {
    readonly exports?: string | Readonly<Record<string, unknown>>;
  };
}

export type WorkspacePackageSource = Architecture | readonly WorkspacePackageInput[];

export interface ImportGraph {
  readonly packages: ReadonlyMap<string, WorkspacePackage>;
  resolveSpecifier(file: string, specifier: string): string | null;
  importsOf(file: string, source: string, mode?: ImportGraphMode): readonly ImportGraphReference[];
  findImportPath(
    entry: string,
    matches: (reference: ImportGraphReference) => boolean,
    overlay?: ReadonlyMap<string, string>,
    mode?: ImportGraphMode,
  ): readonly string[] | null;
  reachCount(entry: string, mode?: ImportGraphMode): number;
}

export function createImportGraph(root: string, source?: WorkspacePackageSource): ImportGraph;
