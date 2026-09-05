import { runCli, type CliEnvironment } from '@zmdb/cli';

export async function installedHelp(lines: string[]): Promise<number> {
  const environment: CliEnvironment = {
    cwd: process.cwd(),
    stdout: text => lines.push(text),
    stderr: text => lines.push(text),
  };
  return runCli(['--help'], environment);
}
