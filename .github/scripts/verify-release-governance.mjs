#!/usr/bin/env node

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadGovernanceSnapshot } from '../../scripts/architecture/governance.mjs';
import { compareText } from '../../scripts/release/lib.mjs';
import { createReleasePlan, currentCoreTarget, releaseModel } from '../../scripts/release/model.mjs';
import { releaseTargetFromTag } from '../../scripts/release/plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function diagnostic(code, subject, detail, remediation) {
  return `[${code}] ${subject}: ${detail}. Remediation: ${remediation}.`;
}

function planDiagnostics(model, tag) {
  let target;
  try {
    target = tag === undefined ? currentCoreTarget(model) : releaseTargetFromTag(tag);
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'RELEASE_TAG_MISMATCH',
          String(tag),
          error instanceof Error ? error.message : String(error),
          'use core-v<version> or <catalog-id>-v<version>',
        ),
      ],
      plan: undefined,
    };
  }
  let plan;
  try {
    plan = createReleasePlan(model, target);
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          'RELEASE_TAG_MISMATCH',
          String(tag),
          error instanceof Error ? error.message : String(error),
          'select one real release unit and valid version',
        ),
      ],
      plan: undefined,
    };
  }

  const diagnostics = [];
  for (const npmName of plan.packages) {
    const packageRecord = model.architecture.packages.find(candidate => candidate.npmName === npmName);
    if (packageRecord === undefined || packageRecord.manifest.version !== plan.version) {
      diagnostics.push(
        diagnostic(
          'RELEASE_TAG_MISMATCH',
          `${tag ?? `${plan.releaseId}-v${plan.version}`} against ${plan.releaseId}@${plan.version}`,
          `${npmName} manifest version is ${String(packageRecord?.manifest.version)}, expected ${plan.version}`,
          'prepare the selected release unit before tagging it',
        ),
      );
    }
  }
  if (plan.changelogEntry.length === 0) {
    diagnostics.push(
      diagnostic(
        'RELEASE_CHANGELOG_MISSING',
        `${plan.releaseId}@${plan.version} at CHANGELOG.md`,
        'no unique non-empty release section exists',
        'add the exact release-id and version section',
      ),
    );
  }
  return { diagnostics, plan };
}

function lockfileHasRange(block, dependency, range) {
  const key = `    ${JSON.stringify(dependency)}: `;
  return [JSON.stringify(range), String(range)].some(serialized => block.includes(`${key}${serialized}`));
}

function lockfileDiagnostics(root, model) {
  const path = join(root, 'yarn.lock');
  if (!existsSync(path)) {
    return [
      diagnostic(
        'RELEASE_WORKSPACE_RANGE',
        'yarn.lock',
        'the release root has no Yarn lockfile',
        'run yarn install --mode=update-lockfile',
      ),
    ];
  }
  const source = readFileSync(path, 'utf8');
  const blocks = source.split(/\n{2,}/);
  const catalogNames = new Set(model.architecture.packages.map(packageRecord => packageRecord.npmName));
  const diagnostics = [];
  for (const packageRecord of model.architecture.packages) {
    const resolution = `resolution: "${packageRecord.npmName}@workspace:${packageRecord.directory}"`;
    const block = blocks.find(candidate => candidate.includes(resolution));
    if (block === undefined) {
      diagnostics.push(
        diagnostic(
          'RELEASE_WORKSPACE_RANGE',
          `${packageRecord.npmName} in yarn.lock`,
          `workspace resolution ${packageRecord.directory} is absent`,
          'run yarn install --mode=update-lockfile',
        ),
      );
      continue;
    }
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = packageRecord.manifest[section];
      if (typeof dependencies !== 'object' || dependencies === null) continue;
      for (const [dependency, range] of Object.entries(dependencies)) {
        if (!catalogNames.has(dependency)) continue;
        if (!lockfileHasRange(block, dependency, range)) {
          diagnostics.push(
            diagnostic(
              'RELEASE_WORKSPACE_RANGE',
              `${packageRecord.npmName} ${section}.${dependency}`,
              `manifest range ${JSON.stringify(range)} is absent from yarn.lock`,
              'run yarn install --mode=update-lockfile',
            ),
          );
        }
      }
    }
  }
  return diagnostics;
}

function releaseConsumerDiagnostics(root, model, plan) {
  const diagnostics = [];
  const requiredTokens = new Map([
    [
      '.github/scripts/lib/publish-manifest.mjs',
      ['loadGovernanceSnapshot', "checks: ['release']", 'publishCatalog', 'publishTrain'],
    ],
    ['.github/scripts/publish-package.mjs', ['RELEASE_EXISTING_MISMATCH', 'dist.integrity']],
    ['.github/scripts/repoint-dist.mjs', ['publishTrain', 'releaseTargetFromTag']],
    ['.github/scripts/set-latest-tag.mjs', ['publishCatalog', 'packages']],
    ['.github/scripts/verify-publish.mjs', ['publishCatalog', 'PUBLISH_PACKAGES']],
  ]);
  for (const [path, tokens] of requiredTokens) {
    const absolute = join(root, path);
    const source = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
    for (const token of tokens) {
      if (!source.includes(token)) {
        diagnostics.push(
          diagnostic(
            'RELEASE_MEMBERSHIP_DRIFT',
            path,
            `release consumer does not use shared ${token}`,
            'consume the product catalog or selected release plan',
          ),
        );
      }
    }
    if (/(?:export\s+)?const\s+PACKAGES\s*=/.test(source)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_MEMBERSHIP_DRIFT',
          path,
          'release consumer declares a handwritten PACKAGES inventory',
          'consume the product catalog',
        ),
      );
    }
  }

  const obsolete = '.github/scripts/prepare-publish.mjs';
  if (existsSync(join(root, obsolete))) {
    diagnostics.push(
      diagnostic(
        'RELEASE_MEMBERSHIP_DRIFT',
        obsolete,
        'obsolete metadata rewrite repeats package membership and version state',
        'use manifests plus target-scoped release preparation',
      ),
    );
  }

  for (const packageRecord of model.architecture.packages) {
    const path = `${packageRecord.directory}/CHANGELOG.md`;
    if (existsSync(join(root, path))) {
      diagnostics.push(
        diagnostic(
          'RELEASE_CHANGELOG_FORMAT',
          path,
          'catalog package carries an independent changelog',
          'record the release note only in root CHANGELOG.md',
        ),
      );
    }
  }

  const workflowPath = '.github/workflows/publish.yml';
  const workflow = readFileSync(join(root, workflowPath), 'utf8');
  for (const token of [
    'node scripts/release/plan.mjs --tag "$RELEASE_TAG" --publish-tsv',
    'node scripts/release/plan.mjs --tag "$RELEASE_TAG" --json',
    'node .github/scripts/repoint-dist.mjs --tag "$RELEASE_TAG"',
    'node .github/scripts/verify-release-governance.mjs --tag "$RELEASE_TAG"',
    'node .github/scripts/publish-package.mjs',
  ]) {
    if (!workflow.includes(token)) {
      diagnostics.push(
        diagnostic(
          'RELEASE_ORDER_DRIFT',
          workflowPath,
          `publish workflow omits ${token}`,
          'consume one verified target plan throughout publication',
        ),
      );
    }
  }
  if (!workflow.includes('if [ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ]; then DRY=true; else DRY=false; fi')) {
    diagnostics.push(
      diagnostic(
        'RELEASE_PARTIAL_TRAIN',
        workflowPath,
        'manual dispatch is not unconditionally dry-run',
        'derive dry-run mode from workflow_dispatch rather than a publish input',
      ),
    );
  }
  if (/\bfor\s+pkg\s+in\b/.test(workflow)) {
    diagnostics.push(
      diagnostic(
        'RELEASE_ORDER_DRIFT',
        workflowPath,
        'publish loop carries a handwritten package sequence',
        'consume releasePlan(root, target).publishOrder',
      ),
    );
  }

  const publishingPath = 'PUBLISHING.md';
  const publishing = readFileSync(join(root, publishingPath), 'utf8');
  if (/\bpackages=\(/.test(publishing) || /\bfor\s+p\s+in\b/.test(publishing)) {
    diagnostics.push(
      diagnostic(
        'RELEASE_MEMBERSHIP_DRIFT',
        publishingPath,
        'documentation carries a copy-paste package inventory',
        'show the target-derived release-plan command',
      ),
    );
  }

  if (new Set(plan.packages).size !== plan.packages.length || plan.packages.length !== plan.publishOrder.length) {
    diagnostics.push(
      diagnostic(
        'RELEASE_PARTIAL_TRAIN',
        `${plan.releaseId}@${plan.version}`,
        'selected package membership is duplicated or incomplete',
        'plan the selected release unit exactly once',
      ),
    );
  }
  if (plan.packages.some((name, index) => name !== plan.publishOrder[index])) {
    diagnostics.push(
      diagnostic(
        'RELEASE_ORDER_DRIFT',
        `${plan.releaseId}@${plan.version}`,
        'package list disagrees with architecture-derived publish order',
        'use one target plan for metadata and publication',
      ),
    );
  }
  return diagnostics;
}

export async function releaseGovernanceDiagnostics(root, tag, includeConsumers = true, options = {}) {
  const snapshot = options.snapshot ?? (await loadGovernanceSnapshot({ root, checks: ['release'] }));
  const model = snapshot.queries.release;
  if (model === undefined) return snapshot.findings.map(item => item.line);
  const planned = planDiagnostics(model, tag);
  const diagnostics = [...planned.diagnostics];
  if (planned.plan === undefined) return diagnostics.toSorted(compareText);

  const target =
    planned.plan.releaseId === 'core'
      ? { kind: 'core', version: planned.plan.version }
      : { kind: 'package', id: planned.plan.releaseId, version: planned.plan.version };
  const first = JSON.stringify(createReleasePlan(model, target));
  const second = JSON.stringify(createReleasePlan(model, target));
  if (first !== second) {
    diagnostics.push(
      diagnostic(
        'RELEASE_ORDER_DRIFT',
        `${planned.plan.releaseId}@${planned.plan.version}`,
        'two read-only evaluations produced different bytes',
        'remove nondeterministic discovery and ordering',
      ),
    );
  }
  if (includeConsumers) {
    diagnostics.push(...lockfileDiagnostics(root, model), ...releaseConsumerDiagnostics(root, model, planned.plan));
  }
  return [...new Set(diagnostics)].toSorted(compareText);
}

function assertEqual(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`);
  }
}

async function withChangelogMutation(fixture, mutate, inspect) {
  const root = mkdtempSync(join(tmpdir(), 'zmdb-release-governance-'));
  try {
    cpSync(fixture, root, { recursive: true });
    const path = join(root, 'CHANGELOG.md');
    writeFileSync(path, mutate(readFileSync(path, 'utf8')));
    return await inspect(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function releaseSnapshot(root) {
  const snapshot = await loadGovernanceSnapshot({ root, checks: ['release'] });
  const model = snapshot.queries.release;
  if (model !== undefined) return { model, snapshot };
  throw new Error(snapshot.findings.map(item => item.line).join('\n') || 'release model is unavailable');
}

async function runSelfTest() {
  const fixtures = join(ROOT, 'scripts', 'architecture', '__fixtures__');
  const valid = join(fixtures, 'valid');
  const { model: validModel, snapshot: validSnapshot } = await releaseSnapshot(valid);
  const target = { kind: 'core', version: '1.0.0-alpha.4' };
  const plan = createReleasePlan(validModel, target);
  assertEqual('valid plan packages', plan.packages, ['@fixture/core', '@fixture/app']);
  assertEqual('valid plan order', plan.publishOrder, ['@fixture/core', '@fixture/app']);
  assertEqual(
    'valid plan determinism',
    createReleasePlan(releaseModel(valid, { architecture: validSnapshot.architecture }), target),
    plan,
  );
  assertEqual(
    'lockfile accepts quoted workspace ranges',
    lockfileHasRange('    "@fixture/core": "workspace:^"', '@fixture/core', 'workspace:^'),
    true,
  );
  assertEqual(
    'lockfile accepts Yarn plain semver ranges',
    lockfileHasRange('    "@fixture/core": 1.0.0-alpha.4', '@fixture/core', '1.0.0-alpha.4'),
    true,
  );
  assertEqual(
    'changelog drift',
    await releaseGovernanceDiagnostics(join(fixtures, 'changelog-drift'), undefined, false),
    [
      '[RELEASE_CHANGELOG_MISSING] core@1.0.0-alpha.4 at CHANGELOG.md: no unique non-empty release section exists. Remediation: add the exact release-id and version section.',
    ],
  );
  assertEqual('matching tag', await releaseGovernanceDiagnostics(valid, 'core-v1.0.0-alpha.4', false), []);
  assertEqual('mismatched tag', await releaseGovernanceDiagnostics(valid, 'core-v1.0.0-alpha.5', false), [
    '[RELEASE_CHANGELOG_MISSING] core@1.0.0-alpha.5 at CHANGELOG.md: no unique non-empty release section exists. Remediation: add the exact release-id and version section.',
    '[RELEASE_TAG_MISMATCH] core-v1.0.0-alpha.5 against core@1.0.0-alpha.5: @fixture/app manifest version is 1.0.0-alpha.4, expected 1.0.0-alpha.5. Remediation: prepare the selected release unit before tagging it.',
    '[RELEASE_TAG_MISMATCH] core-v1.0.0-alpha.5 against core@1.0.0-alpha.5: @fixture/core manifest version is 1.0.0-alpha.4, expected 1.0.0-alpha.5. Remediation: prepare the selected release unit before tagging it.',
  ]);
  assertEqual(
    'unknown changelog owner',
    await withChangelogMutation(
      valid,
      source =>
        source.replace(
          '**product:** reserve pending fixture changes.',
          '**unknown:** reserve pending fixture changes.',
        ),
      root => releaseGovernanceDiagnostics(root, undefined, false),
    ),
    [
      '[RELEASE_CHANGELOG_OWNER] Unreleased names unknown: bullet owner is neither a catalog id nor product. Remediation: prefix the bullet with the owning catalog id or product.',
    ],
  );
  console.log('Release governance self-test passed: target plans, changelog, order, determinism, owner, and tags.');
}

function parseArguments(argv) {
  let root = ROOT;
  let tag;
  let selfTest = false;
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--root') {
      const value = argv[++index];
      if (value === undefined) throw new Error('--root requires a path');
      root = resolve(value);
    } else if (argument === '--tag') {
      const value = argv[++index];
      if (value === undefined) throw new Error('--tag requires a value');
      tag = value;
    } else if (argument === '--self-test') {
      selfTest = true;
    } else {
      throw new Error(`unknown argument ${argument}`);
    }
  }
  return { root, selfTest, tag };
}

async function main(argv) {
  const options = parseArguments(argv);
  if (options.selfTest) {
    await runSelfTest();
    return;
  }
  const includeConsumers = existsSync(join(options.root, '.github', 'workflows', 'publish.yml'));
  const snapshot = await loadGovernanceSnapshot({ root: options.root, checks: ['release'] });
  const diagnostics = await releaseGovernanceDiagnostics(options.root, options.tag, includeConsumers, { snapshot });
  if (diagnostics.length > 0) {
    for (const item of diagnostics) console.error(item);
    process.exitCode = 1;
    return;
  }
  const model = snapshot.queries.release;
  if (model === undefined) throw new Error('release model is unavailable');
  const target = options.tag === undefined ? currentCoreTarget(model) : releaseTargetFromTag(options.tag);
  const plan = createReleasePlan(model, target);
  console.log(
    `release governance: ${plan.releaseId}@${plan.version} selects ${String(plan.packages.length)} package(s) in policy-derived order.`,
  );
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  void main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  });
}
