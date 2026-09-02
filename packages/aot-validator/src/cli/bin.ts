#!/usr/bin/env node
// The `zmdb-codegen` executable. Argument parsing and exit codes; the work is in `./index.ts`.

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { codegen, watchCodegen } from './index.ts';

const USAGE = `zmdb-codegen — compile zmdb's validators ahead of time, without a bundler.

  zmdb-codegen [--project <tsconfig.json>] [--check] [--watch]

  --project <path>  the project to generate for. Default: ./tsconfig.json
  --check           write nothing; exit 1 if anything on disk is out of date
  --watch           regenerate on every save, on one compiler session

For each source file that calls is/equals/assert/assertEquals/validate/random/toJsonSchema/
schemaOf with a type argument, this writes three files beside it — a witness the compiler
checks, the compiled JavaScript, and its declarations — and rewrites the call to use them.
Commit all four: the point is that a fresh clone builds the fast path with no tool involved.
`;

function main(argv: readonly string[]): number | Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    return 0;
  }

  const at = argv.indexOf('--project');
  const named = at === -1 ? undefined : argv[at + 1];
  if (at !== -1 && named === undefined) {
    process.stderr.write('zmdb-codegen: --project needs a path\n');
    return 2;
  }
  const project = resolve(named ?? join(process.cwd(), 'tsconfig.json'));
  if (!existsSync(project)) {
    process.stderr.write(`zmdb-codegen: no project at ${project}\n`);
    return 2;
  }

  const check = argv.includes('--check');
  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  if (argv.includes('--watch')) {
    if (check) {
      process.stderr.write('zmdb-codegen: --check and --watch ask for opposite things\n');
      return 2;
    }
    return watchCodegen({ project, log }).then(() => 0);
  }

  const result = codegen({ project, check, log });
  for (const problem of result.problems) process.stderr.write(`error: ${problem}\n`);
  if (result.problems.length > 0) return 1;
  if (check && !result.ok) {
    // Not an error in the code — an error in the tree. The distinction matters to whoever
    // reads the CI log, so it gets its own sentence rather than a bare exit code.
    process.stderr.write(
      `zmdb-codegen: ${String(result.written.length + result.deleted.length)} generated file(s) are out of date. Run \`zmdb-codegen\` and commit the result.\n`,
    );
    return 1;
  }
  return 0;
}

const status = await main(process.argv.slice(2));
process.exit(status);
