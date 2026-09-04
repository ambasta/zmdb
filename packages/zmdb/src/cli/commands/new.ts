import type { ParsedCommand } from '../args.js';
import type { CliOutput } from '../output.js';
import {
  renderScaffold,
  scaffold,
  ScaffoldConflictError,
  ScaffoldUsageError,
  type ScaffoldResult,
} from '../scaffold.js';

export async function createNewScaffold(parsed: ParsedCommand, output: CliOutput, cwd: string): Promise<number> {
  const kind = parsed.positionals[0];
  const name = parsed.positionals[1];
  if (kind === undefined || name === undefined) {
    return output.failure('usage: zmdb new <project|schema|controller|module|repository|command> <name>', 2);
  }

  try {
    const result = await scaffold({
      cwd,
      kind,
      name,
      ...(typeof parsed.values.package === 'string' ? { package: parsed.values.package } : {}),
      dryRun: parsed.values['dry-run'] === true,
    });
    return output.result(publicResult(result), renderScaffold(result));
  } catch (error) {
    if (error instanceof ScaffoldUsageError) return output.failure(error.message, 2);
    if (error instanceof ScaffoldConflictError) return output.failure(error.message, 1);
    return output.failure(error instanceof Error ? error.message : String(error), 1);
  }
}

function publicResult(result: ScaffoldResult): {
  readonly kind: ScaffoldResult['kind'];
  readonly name: string;
  readonly target: string;
  readonly files: readonly string[];
  readonly dryRun: boolean;
} {
  return {
    kind: result.kind,
    name: result.name.input,
    target: result.target,
    files: result.files.map(file => file.path),
    dryRun: result.dryRun,
  };
}
