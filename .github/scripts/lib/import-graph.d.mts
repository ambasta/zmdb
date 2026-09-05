export interface ImportGraphReference {
  readonly file?: string;
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

export interface ImportGraph {
  readonly packages: ReadonlyMap<string, WorkspacePackage>;
  resolveSpecifier(file: string, specifier: string): string | null;
  importsOf(file: string, source: string): readonly ImportGraphReference[];
  findImportPath(
    entry: string,
    matches: (reference: ImportGraphReference) => boolean,
    overlay?: ReadonlyMap<string, string>,
  ): readonly string[] | null;
  reachCount(entry: string): number;
}

export function createImportGraph(root: string, packages?: readonly WorkspacePackageInput[]): ImportGraph;
