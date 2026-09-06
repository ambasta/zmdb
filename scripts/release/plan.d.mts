export interface ReleasePlan {
  readonly version: string;
  readonly packages: readonly string[];
  readonly publishOrder: readonly string[];
  readonly changelogEntry: string;
}

export function releasePlan(root: string): ReleasePlan;
