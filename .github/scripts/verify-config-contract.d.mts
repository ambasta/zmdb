import type { Architecture } from '../../scripts/architecture/index.mjs';

export interface ConfigContractReport {
  readonly owner: string;
  readonly authoringOwner: string;
  readonly facade: string;
  readonly problems: readonly string[];
}

export function inspectConfigContract(
  root: string | undefined,
  overlays: ReadonlyMap<string, string> | undefined,
  options: { readonly architecture: Architecture },
): ConfigContractReport;
