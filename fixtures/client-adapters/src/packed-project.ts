import { spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface PackedPackageSource {
  readonly directory: string;
  readonly manifest?: Readonly<Record<string, unknown>>;
}

export interface PackedProjectCommand {
  readonly label: string;
  readonly command: string;
  readonly arguments?: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface PackedProjectPlan {
  readonly name: string;
  readonly packages: readonly PackedPackageSource[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly files?: Readonly<Record<string, string>>;
  readonly commands?: readonly PackedProjectCommand[];
  readonly temporaryDirectory?: string;
}

export interface PackedTarball {
  readonly name: string;
  readonly path: string;
  readonly sourceDirectory: string;
}

export interface PackedCommandResult {
  readonly label: string;
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PackedProjectResult {
  readonly directory: string;
  readonly application: string;
  readonly tarballs: ReadonlyMap<string, PackedTarball>;
  readonly commands: readonly PackedCommandResult[];
  cleanup(): void;
}

interface PackageManifest {
  readonly name?: string;
  readonly dependencies?: Readonly<Record<string, string>>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function packFilename(output: string): string {
  const report: unknown = JSON.parse(output);
  const row = Array.isArray(report) ? report[0] : isRecord(report) ? Object.values(report)[0] : undefined;
  if (!isRecord(row) || typeof row['filename'] !== 'string') {
    throw new Error(`npm pack returned no filename: ${output}`);
  }
  return row['filename'];
}

function commandOutput(result: ReturnType<typeof spawnSync>): string {
  return [result.stdout, result.stderr]
    .filter(value => value !== undefined && value !== '')
    .join('\n')
    .trim();
}

function run(command: string, arguments_: readonly string[], cwd: string, env?: Readonly<Record<string, string>>) {
  return spawnSync(command, [...arguments_], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function requireSuccess(
  label: string,
  result: ReturnType<typeof spawnSync>,
): asserts result is typeof result & {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
} {
  if (result.status !== 0) {
    throw new Error(`${label} failed with ${String(result.status)}\n${commandOutput(result)}`);
  }
}

function copyPackage(source: string, destination: string): void {
  cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter: path => !path.split(sep).includes('node_modules'),
  });
}

function writeProjectFile(application: string, path: string, contents: string): void {
  if (isAbsolute(path)) throw new Error(`packed project file must be relative: ${path}`);
  const destination = resolve(application, path);
  const rel = relative(application, destination);
  if (rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`packed project file escapes the application: ${path}`);
  }
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, contents);
}

function packagePath(nodeModules: string, name: string): string {
  return join(nodeModules, ...name.split('/'));
}

function assertPackedInstall(application: string, tarball: PackedTarball): void {
  const installed = packagePath(join(application, 'node_modules'), tarball.name);
  if (lstatSync(installed).isSymbolicLink()) {
    throw new Error(`${tarball.name} resolved through a symlink instead of its tarball`);
  }
  const installedReal = realpathSync(installed);
  const applicationReal = realpathSync(application);
  const sourceReal = realpathSync(tarball.sourceDirectory);
  if (installedReal === sourceReal || !installedReal.startsWith(`${applicationReal}${sep}`)) {
    throw new Error(`${tarball.name} resolved to workspace source ${installedReal}`);
  }
  const installedManifest = readFileSync(join(installed, 'package.json'), 'utf8');
  if (installedManifest.includes('workspace:')) {
    throw new Error(`${tarball.name} packed manifest still contains a workspace protocol`);
  }
}

function packPackages(plan: PackedProjectPlan, directory: string): ReadonlyMap<string, PackedTarball> {
  const tarballs = new Map<string, PackedTarball>();
  const stageRoot = join(directory, 'stage');
  const archiveRoot = join(directory, 'tarballs');
  mkdirSync(stageRoot, { recursive: true });
  mkdirSync(archiveRoot, { recursive: true });

  for (const [index, source] of plan.packages.entries()) {
    const stage = join(stageRoot, String(index));
    copyPackage(source.directory, stage);
    if (source.manifest !== undefined) {
      writeFileSync(join(stage, 'package.json'), `${JSON.stringify(source.manifest, null, 2)}\n`);
    }
    const manifest = JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')) as PackageManifest;
    if (typeof manifest.name !== 'string' || manifest.name.length === 0) {
      throw new Error(`${source.directory} has no package name`);
    }
    if (JSON.stringify(manifest).includes('workspace:')) {
      throw new Error(`${manifest.name} must receive a publish-ready manifest before packing`);
    }

    const packed = run('npm', ['pack', '--json', '--pack-destination', archiveRoot], stage, {
      COREPACK_ENABLE_PROJECT_SPEC: '0',
    });
    requireSuccess(`${manifest.name} npm pack`, packed);
    const tarball = Object.freeze({
      name: manifest.name,
      path: join(archiveRoot, packFilename(packed.stdout)),
      sourceDirectory: source.directory,
    });
    if (tarballs.has(tarball.name)) throw new Error(`duplicate packed package ${tarball.name}`);
    tarballs.set(tarball.name, tarball);
  }

  return tarballs;
}

export function runPackedProject(plan: PackedProjectPlan): PackedProjectResult {
  if (plan.packages.length === 0) throw new Error('packed project requires at least one tarball');
  const directory = mkdtempSync(join(plan.temporaryDirectory ?? tmpdir(), 'zmdb-adapter-packed-'));
  let cleaned = false;

  try {
    const tarballs = packPackages(plan, directory);
    const application = join(directory, 'application');
    mkdirSync(application, { recursive: true });
    const dependencies = {
      ...plan.dependencies,
      ...Object.fromEntries([...tarballs].map(([name, tarball]) => [name, `file:${tarball.path}`])),
    };
    writeFileSync(
      join(application, 'package.json'),
      `${JSON.stringify(
        {
          name: plan.name,
          private: true,
          type: 'module',
          dependencies,
          ...(plan.devDependencies === undefined ? {} : { devDependencies: plan.devDependencies }),
        },
        null,
        2,
      )}\n`,
    );
    for (const [path, contents] of Object.entries(plan.files ?? {})) {
      writeProjectFile(application, path, contents);
    }

    const installed = run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--loglevel=error'],
      application,
      { COREPACK_ENABLE_PROJECT_SPEC: '0' },
    );
    requireSuccess(`${plan.name} tarball install`, installed);
    for (const tarball of tarballs.values()) assertPackedInstall(application, tarball);

    const commandResults: PackedCommandResult[] = [];
    for (const command of plan.commands ?? []) {
      const cwd = resolve(application, command.cwd ?? '.');
      const rel = relative(application, cwd);
      if (rel === '..' || rel.startsWith(`..${sep}`)) {
        throw new Error(`${command.label} command escapes the packed application`);
      }
      const result = run(command.command, command.arguments ?? [], cwd, command.env);
      requireSuccess(command.label, result);
      commandResults.push(
        Object.freeze({
          label: command.label,
          status: result.status,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
      );
    }

    return Object.freeze({
      directory,
      application,
      tarballs,
      commands: Object.freeze(commandResults),
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        rmSync(directory, { recursive: true, force: true });
      },
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
