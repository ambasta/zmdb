export interface ConfigContractReport {
  readonly owner: string;
  readonly authoringOwner: string;
  readonly facade: string;
  readonly problems: readonly string[];
}

export function inspectConfigContract(root?: string, overlays?: ReadonlyMap<string, string>): ConfigContractReport;
