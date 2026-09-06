export interface ReleasePlan {
  readonly releaseId: string;
  readonly version: string;
  readonly packages: readonly string[];
  readonly publishOrder: readonly string[];
  readonly manifestChanges: readonly {
    readonly package: string;
    readonly version: string;
    readonly ranges: Readonly<Record<string, string>>;
  }[];
  readonly compatibilityCases: readonly string[];
  readonly changelogEntry: string;
}

export type ReleaseTarget =
  | { readonly kind: 'core'; readonly version: string }
  | { readonly kind: 'package'; readonly id: string; readonly version: string };

export function releaseTargetFromTag(tag: string): ReleaseTarget;

export function releasePlan(
  root: string,
  target: ReleaseTarget | undefined,
  options: { readonly architecture: Architecture },
): ReleasePlan;
import type { Architecture } from '../architecture/index.mjs';
