// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { compileProject, watchCodegen, writeCompileResult } from '@zmdb/compiler';
import { loadConfig } from '@zmdb/compiler/config';

import type { ParsedCommand } from '../args.js';
import { errorMessage } from '../errors.js';
import { withSignals } from '../lifecycle.js';
import { CliOutput } from '../output.js';

interface CodegenEnvironment {
  readonly cwd: string;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export async function runCodegen(parsed: ParsedCommand, io: CodegenEnvironment): Promise<number> {
  const output = new CliOutput('codegen', parsed.config, parsed.json, io);
  if (parsed.values.check === true && parsed.values.watch === true) {
    return output.failure('--check and --watch ask for opposite things', 2);
  }
  if (parsed.json && parsed.values.watch === true) {
    return output.failure('--json is unavailable because a watch session is not one JSON document', 2);
  }
  if (typeof parsed.values.config === 'string' && !existsSync(parsed.config)) {
    return output.failure(`config file ${parsed.config} does not exist`, 2);
  }
  let config: Awaited<ReturnType<typeof loadConfig>> | undefined;
  try {
    config =
      typeof parsed.values.config === 'string' || existsSync(parsed.config)
        ? await loadConfig({ cwd: io.cwd, path: parsed.config })
        : undefined;
  } catch (error) {
    return output.failure(errorMessage(error), 2);
  }
  try {
    const project =
      parsed.project === undefined
        ? (config?.project ?? resolve(io.cwd, 'tsconfig.json'))
        : resolve(io.cwd, parsed.project);
    const options = { project, ...(config?.resolvedNaming === undefined ? {} : { naming: config.resolvedNaming }) };
    if (parsed.values.watch === true) {
      const result = await withSignals(until =>
        watchCodegen({
          ...options,
          until,
          log: text => output.progress(`${text}\n`),
        }),
      );
      return result === undefined || result.problems.length === 0 ? 0 : 1;
    }
    const compiled = await compileProject(options);
    if (compiled.diagnostics.length > 0) {
      return output.failure(
        compiled.diagnostics
          .map(item => `${item.code}: ${item.message}${item.file === undefined ? '' : ` (${item.file})`}`)
          .join('\n'),
        1,
      );
    }
    const result = await writeCompileResult(compiled, { check: parsed.values.check === true });
    const code = parsed.values.check === true && result.stale.length > 0 ? 1 : 0;
    return output.result(
      result,
      `${result.stale.length === 0 ? 'up to date' : result.stale.map(path => `${parsed.values.check === true ? 'stale' : 'generated'} ${path}`).join('\n')}\n`,
      code,
    );
  } catch (error) {
    return output.failure(errorMessage(error), 1);
  }
}
