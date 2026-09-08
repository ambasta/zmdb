import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { CONSUMER_CASES } from '../../../fixtures/consumer-release-compatibility/cases.mjs';
import { RELEASE_PACKAGE_POLICY } from '../../../scripts/release/policy.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const ENTRY = resolve(ROOT, '.github/scripts/verify-release-compatibility.mjs');

interface CompatibilityCase {
  readonly id: string;
  readonly packageId: string;
  readonly kind: 'supported' | 'below-floor' | 'incompatible-core' | 'independent-integration';
  readonly selection: Readonly<Record<string, string>>;
  readonly constraint?: {
    readonly owner: string;
    readonly dependency: string;
    readonly range: string;
  };
}

interface CompatibilityEntry {
  readonly releaseCompatibilityPlan: (root: string) => readonly CompatibilityCase[];
  readonly compatibilityManifestProblems: (
    root: string,
    manifests: Readonly<Record<string, unknown>>,
  ) => readonly string[];
  readonly assertCompatibilityReport: (plan: readonly CompatibilityCase[], report: unknown) => void;
  readonly verifyConsumerInstallation: (options: {
    directory: string;
    archives: readonly unknown[];
  }) => Promise<unknown>;
  readonly withCompatibilityWorkspace: <T>(
    parent: string,
    run: (paths: { directory: string; cache: string }) => Promise<T>,
  ) => Promise<T>;
}

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});
async function scratch() {
  const path = await mkdtemp(join(dirname(ROOT), 'release-compatibility-unit-'));
  temporary.push(path);
  return path;
}

function completeReport(plan: readonly CompatibilityCase[]) {
  return {
    runtime: 'v26.4.0',
    packageManager: 'npm 11.5.2',
    base: '0123456789abcdef0123456789abcdef01234567',
    archives: [
      {
        name: '@zmdb/ai-vercel',
        version: '1.0.0-alpha.4',
        file: '/unit/archive.tgz',
        sha256: 'a'.repeat(64),
        integrity: 'sha512-unit',
      },
    ],
    cleaned: true,
    registryClosed: true,
    cases: plan.map(item => ({
      caseId: item.id,
      packageId: item.packageId,
      kind: item.kind,
      selection: item.selection,
      passed: true,
      cleaned: true,
      evidence: 'controlled report-validator unit input',
      commands:
        item.kind === 'below-floor' || item.kind === 'incompatible-core'
          ? [{ stage: 'install', exitCode: 1 }]
          : ['install', 'lock-reinstall', 'types', 'runtime', 'resolution'].map(stage => ({ stage, exitCode: 0 })),
      installed: [
        {
          name: '@zmdb/ai-vercel',
          version: '1.0.0-alpha.4',
          resolved: 'http://127.0.0.1:1/archive.tgz',
          integrity: 'sha512-unit',
        },
      ],
      ...(item.kind === 'below-floor' || item.kind === 'incompatible-core'
        ? {
            expectedRefusal: {
              ...item.constraint,
              selected: item.selection[item.constraint?.dependency ?? ''] ?? '<floor',
              diagnostic: `ERESOLVE ${item.constraint?.owner} requires ${item.constraint?.dependency}@${item.constraint?.range}`,
            },
          }
        : {}),
    })),
  };
}

async function entry(): Promise<CompatibilityEntry> {
  expect(existsSync(ENTRY), 'the release compatibility gate must have its own executable entry point').toBe(true);
  const namespace: CompatibilityEntry = await import(pathToFileURL(ENTRY).href);
  expect(namespace.releaseCompatibilityPlan).toBeTypeOf('function');
  return namespace;
}

describe('installed release compatibility (#750)', () => {
  it('derives executable supported lanes for every public release unit', async () => {
    const { releaseCompatibilityPlan } = await entry();
    const cases = releaseCompatibilityPlan(ROOT);
    const supported = cases.filter(item => item.kind === 'supported');
    expect(new Set(supported.map(item => item.packageId))).toEqual(new Set(Object.keys(RELEASE_PACKAGE_POLICY)));
    for (const [id, policy] of Object.entries(RELEASE_PACKAGE_POLICY))
      for (const [peer, constraint] of Object.entries(policy.peers))
        for (const version of constraint.tested)
          expect(
            supported.some(item => item.packageId === id && item.selection[peer] === version),
            `${id}: ${peer}@${version}`,
          ).toBe(true);
    expect(new Set(cases.map(item => item.id)).size).toBe(cases.length);
    expect(new Set(Object.keys(CONSUMER_CASES))).toEqual(new Set(Object.keys(RELEASE_PACKAGE_POLICY)));
    for (const fixture of Object.values(CONSUMER_CASES)) {
      expect(Object.keys(fixture.files).some(path => path.endsWith('.ts'))).toBe(true);
      for (const path of Object.keys(fixture.files)) expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(fixture.evidence).not.toBe('');
    }
    for (const item of cases) {
      expect(item.id).not.toBe('');
      expect(Object.keys(item.selection).length, item.id).toBeGreaterThan(0);
      expect(
        Object.values(item.selection).some(version => /workspace:|file:|link:/.test(version)),
        item.id,
      ).toBe(false);
    }
  });

  it('keeps core lockstep while selecting an independently versioned integration', async () => {
    const { releaseCompatibilityPlan } = await entry();
    const plan = releaseCompatibilityPlan(ROOT);
    const independent = plan.filter(item => item.kind === 'independent-integration');
    expect(independent.length).toBeGreaterThan(0);
    for (const item of independent) {
      expect(RELEASE_PACKAGE_POLICY[item.packageId as keyof typeof RELEASE_PACKAGE_POLICY]?.group).toBe('integration');
      const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', item.packageId, 'package.json'), 'utf8'));
      expect(item.selection[manifest.name]).not.toBe(manifest.version);
      for (const [id, policy] of Object.entries(RELEASE_PACKAGE_POLICY))
        if (policy.group === 'core') {
          const core = JSON.parse(readFileSync(join(ROOT, 'packages', id, 'package.json'), 'utf8'));
          if (Object.hasOwn(item.selection, core.name)) expect(item.selection[core.name]).toBe(core.version);
        }
    }
  });

  it('includes the exact AI SDK floor as real selected dependency input', async () => {
    const { releaseCompatibilityPlan } = await entry();
    const policy = RELEASE_PACKAGE_POLICY['ai-vercel']!.peers.ai!;
    expect(policy.floor).toBe('7.0.93');
    expect(policy.tested).toContain('7.0.93');
    expect(releaseCompatibilityPlan(ROOT)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageId: 'ai-vercel',
          kind: 'supported',
          selection: expect.objectContaining({ ai: '7.0.93' }),
        }),
      ]),
    );
  });

  it('requires an attributed refusal below every peer floor and across incompatible core versions', async () => {
    const { releaseCompatibilityPlan } = await entry();
    const cases = releaseCompatibilityPlan(ROOT);
    for (const [packageId, policy] of Object.entries(RELEASE_PACKAGE_POLICY)) {
      for (const [dependency, peer] of Object.entries(policy.peers)) {
        const refusals = cases.filter(
          item =>
            item.packageId === packageId && item.kind === 'below-floor' && item.constraint?.dependency === dependency,
        );
        expect(refusals.length, `${packageId} -> ${dependency}`).toBeGreaterThan(0);
        for (const refusal of refusals) expect(refusal.constraint?.range).toBe(peer.range);
      }
    }
    expect(cases.some(item => item.kind === 'incompatible-core')).toBe(true);
  });

  it('rejects a corrupted actual manifest range against authoritative policy', async () => {
    const { compatibilityManifestProblems } = await entry();
    const manifests = Object.fromEntries(
      Object.keys(RELEASE_PACKAGE_POLICY).map(id => [
        id,
        JSON.parse(readFileSync(join(ROOT, 'packages', id, 'package.json'), 'utf8')),
      ]),
    );
    expect(compatibilityManifestProblems(ROOT, manifests)).toEqual([]);
    manifests['ai-vercel'].peerDependencies.ai = '*';
    expect(compatibilityManifestProblems(ROOT, manifests).join('\n')).toMatch(/ai-vercel.*ai.*7\.0\.93/);
    manifests['ai-vercel'].peerDependencies.ai = RELEASE_PACKAGE_POLICY['ai-vercel']!.peers.ai!.range;
    manifests.app.version = '2.0.0';
    expect(compatibilityManifestProblems(ROOT, manifests).join('\n')).toMatch(/app.*version/i);
  });

  it('accepts complete reports and refuses missing, duplicate, failed or unclean cases and missing proof stages', async () => {
    const { releaseCompatibilityPlan, assertCompatibilityReport } = await entry();
    const plan = releaseCompatibilityPlan(ROOT).filter(
      item => item.packageId === 'ai-vercel' && item.kind === 'supported',
    );
    expect(plan.length).toBeGreaterThan(0);
    expect(() => assertCompatibilityReport(plan, completeReport(plan))).not.toThrow();
    const mutate = (change: (report: ReturnType<typeof completeReport>) => void) => {
      const report = completeReport(plan);
      change(report);
      expect(() => assertCompatibilityReport(plan, report)).toThrow();
    };
    mutate(report => {
      report.cases.pop();
    });
    mutate(report => {
      report.cases.push(report.cases[0]!);
    });
    mutate(report => {
      report.cases[0]!.passed = false;
    });
    mutate(report => {
      report.cases[0]!.cleaned = false;
    });
    mutate(report => {
      report.cleaned = false;
    });
    mutate(report => {
      report.registryClosed = false;
    });
    for (const stage of ['install', 'lock-reinstall', 'types', 'runtime', 'resolution']) {
      mutate(report => {
        report.cases[0]!.commands = report.cases[0]!.commands.filter(command => command.stage !== stage);
      });
      mutate(report => {
        report.cases[0]!.commands.find(command => command.stage === stage)!.exitCode = 17;
      });
    }
    mutate(report => {
      report.archives = [];
    });
    mutate(report => {
      report.runtime = '';
    });
    mutate(report => {
      report.packageManager = '';
    });
  });

  it('requires each negative installation to fail at its intended constraint', async () => {
    const { releaseCompatibilityPlan, assertCompatibilityReport } = await entry();
    const plan = releaseCompatibilityPlan(ROOT).filter(
      item => item.packageId === 'ai-vercel' && item.kind === 'below-floor',
    );
    expect(plan.length).toBeGreaterThan(0);
    expect(() => assertCompatibilityReport(plan, completeReport(plan))).not.toThrow();
    for (const change of [
      (report: ReturnType<typeof completeReport>) => {
        report.cases[0]!.commands[0]!.exitCode = 0;
      },
      (report: ReturnType<typeof completeReport>) => {
        report.cases[0]!.expectedRefusal!.diagnostic = 'network ECONNRESET';
      },
      (report: ReturnType<typeof completeReport>) => {
        report.cases[0]!.expectedRefusal!.dependency = 'wrong-peer';
      },
    ]) {
      const report = completeReport(plan);
      change(report);
      expect(() => assertCompatibilityReport(plan, report)).toThrow();
    }
  });

  it('checks the real installed location and lock integrity and rejects a workspace link', async () => {
    const { verifyConsumerInstallation } = await entry();
    const directory = await scratch();
    const packageDirectory = join(directory, 'node_modules/@zmdb/schema');
    await mkdir(packageDirectory, { recursive: true });
    const manifest = { name: '@zmdb/schema', version: '1.0.0-alpha.4', dependencies: {} };
    await writeFile(join(packageDirectory, 'package.json'), JSON.stringify(manifest));
    const lock = {
      lockfileVersion: 3,
      packages: {
        '': { dependencies: { '@zmdb/schema': '1.0.0-alpha.4' } },
        'node_modules/@zmdb/schema': {
          version: manifest.version,
          resolved: 'http://127.0.0.1:1/schema.tgz',
          integrity: 'sha512-unit',
        },
      },
    };
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock));
    const archives = [{ manifest, file: '/unit/schema.tgz', sha256: 'a'.repeat(64), integrity: 'sha512-unit' }];
    await expect(verifyConsumerInstallation({ directory, archives })).resolves.toBeDefined();
    lock.packages['node_modules/@zmdb/schema'].integrity = 'sha512-corrupt';
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock));
    await expect(verifyConsumerInstallation({ directory, archives })).rejects.toThrow(/integrity/i);
    lock.packages['node_modules/@zmdb/schema'].integrity = 'sha512-unit';
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock));
    await rm(packageDirectory, { recursive: true });
    await symlink(join(ROOT, 'packages/schema'), packageDirectory, 'dir');
    await expect(verifyConsumerInstallation({ directory, archives })).rejects.toThrow(/escaped|workspace|link/i);
  });

  it('removes real temporary consumers and caches after success and a rejected operation', async () => {
    const { withCompatibilityWorkspace } = await entry();
    const parent = await scratch();
    for (const failure of ['none', 'consumer', 'timeout']) {
      let paths: { directory: string; cache: string } | undefined;
      const operation = withCompatibilityWorkspace(parent, async created => {
        paths = created;
        await writeFile(join(created.cache, 'payload'), 'cache');
        await writeFile(join(created.directory, 'payload'), 'consumer');
        if (failure === 'consumer') throw new Error('consumer exit 17');
        if (failure === 'timeout') {
          const { command } = await import(pathToFileURL(join(ROOT, 'fixtures/consumer-cli/registry.mjs')).href);
          await command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
            cwd: created.directory,
            timeout: 50,
          });
        }
        return 'completed';
      });
      if (failure !== 'none')
        await expect(operation).rejects.toThrow(failure === 'consumer' ? 'consumer exit 17' : 'TIMEOUT');
      else await expect(operation).resolves.toBe('completed');
      expect(paths).toBeDefined();
      expect(existsSync(paths!.directory)).toBe(false);
      expect(existsSync(paths!.cache)).toBe(false);
    }
  });
});
