#!/usr/bin/env node

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { compareText } from '../../scripts/release/lib.mjs';
import { ReleaseGovernanceError, releaseModel } from '../../scripts/release/model.mjs';
import { releasePlan } from '../../scripts/release/plan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function diagnostic(code, subject, detail, remediation) {
  return `[${code}] ${subject}: ${detail}. Remediation: ${remediation}.`;
}

function tagDiagnostics(version, tag) {
  if (tag === undefined || tag === `v${version}`) return [];
  return [
    diagnostic(
      'RELEASE_TAG_MISMATCH',
      `${tag} against ${version}`,
      'triggering tag disagrees with the common package version',
      'tag the verified commit exactly v<version>',
    ),
  ];
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
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      const dependencies = packageRecord.manifest[section];
      if (typeof dependencies !== 'object' || dependencies === null) continue;
      for (const [dependency, range] of Object.entries(dependencies)) {
        if (!catalogNames.has(dependency)) continue;
        const expected = `    "${dependency}": "workspace:^"`;
        if (range !== 'workspace:^' || !block.includes(expected)) {
          diagnostics.push(
            diagnostic(
              'RELEASE_WORKSPACE_RANGE',
              `${packageRecord.npmName} dependency ${dependency}`,
              `manifest/lockfile range is ${JSON.stringify(range)}, expected workspace:^`,
              'restore workspace:^ and run yarn install --mode=update-lockfile',
            ),
          );
        }
      }
    }
  }
  return diagnostics;
}

function releaseConsumerDiagnostics(root, model) {
  const diagnostics = [];
  const requiredTokens = new Map([
    ['.github/scripts/lib/publish-manifest.mjs', ['releaseModel', 'publishTrain']],
    ['.github/scripts/publish-package.mjs', ['RELEASE_EXISTING_MISMATCH', 'dist.integrity']],
    ['.github/scripts/repoint-dist.mjs', ['publishTrain', 'release.packages', 'release.version']],
    ['.github/scripts/set-latest-tag.mjs', ['publishTrain', 'release.packages']],
    ['.github/scripts/verify-publish.mjs', ['publishTrain', 'PUBLISH_PACKAGES', 'RELEASE_VERSION']],
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
            `release consumer does not use catalog-derived ${token}`,
            'consume the shared release model',
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
        'use manifests plus the whole-train bump',
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
  if (!workflow.includes('node scripts/release/plan.mjs --publish-tsv')) {
    diagnostics.push(
      diagnostic(
        'RELEASE_ORDER_DRIFT',
        workflowPath,
        'publish loop does not consume the policy-derived TSV plan',
        'consume releasePlan(root).publishOrder',
      ),
    );
  }
  if (!workflow.includes('node .github/scripts/publish-package.mjs')) {
    diagnostics.push(
      diagnostic(
        'RELEASE_PARTIAL_TRAIN',
        workflowPath,
        'publish loop does not verify and resume an interrupted immutable package train',
        'publish through the byte-identical retry helper',
      ),
    );
  }
  if (!workflow.includes('node .github/scripts/verify-release-governance.mjs --tag "$GITHUB_REF_NAME"')) {
    diagnostics.push(
      diagnostic(
        'RELEASE_TAG_MISMATCH',
        workflowPath,
        'tag-triggered publication does not pass the triggering tag to release verification',
        'verify GITHUB_REF_NAME before build and publication',
      ),
    );
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
        'consume releasePlan(root).publishOrder',
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
        'show the catalog-derived release-plan command',
      ),
    );
  }

  const catalogNames = model.architecture.packages
    .toSorted((left, right) => compareText(left.id, right.id))
    .map(packageRecord => packageRecord.npmName);
  if (
    model.plan.packages.length !== catalogNames.length ||
    model.plan.packages.some((name, index) => name !== catalogNames[index]) ||
    new Set(model.plan.packages).size !== catalogNames.length
  ) {
    diagnostics.push(
      diagnostic(
        'RELEASE_PARTIAL_TRAIN',
        'release plan',
        'catalog membership is duplicated, reordered or incomplete',
        'plan the complete product catalog exactly once',
      ),
    );
  }
  if (
    model.entries.length !== model.plan.publishOrder.length ||
    model.entries.some((entry, index) => entry.npmName !== model.plan.publishOrder[index]) ||
    new Set(model.plan.publishOrder).size !== catalogNames.length
  ) {
    diagnostics.push(
      diagnostic(
        'RELEASE_ORDER_DRIFT',
        'release plan',
        'publication entries disagree with the policy-derived order',
        'consume releasePlan(root).publishOrder',
      ),
    );
  }
  return diagnostics;
}

export function releaseGovernanceDiagnostics(root, tag, includeConsumers = true) {
  let model;
  try {
    model = releaseModel(root);
  } catch (error) {
    if (error instanceof ReleaseGovernanceError) return error.diagnostics;
    throw error;
  }
  const first = JSON.stringify(releasePlan(root));
  const second = JSON.stringify(releasePlan(root));
  const diagnostics = [...tagDiagnostics(model.plan.version, tag)];
  if (first !== second) {
    diagnostics.push(
      diagnostic(
        'RELEASE_ORDER_DRIFT',
        'release plan',
        'two read-only evaluations produced different bytes',
        'remove nondeterministic discovery and ordering',
      ),
    );
  }
  if (includeConsumers) {
    diagnostics.push(...lockfileDiagnostics(root, model), ...releaseConsumerDiagnostics(root, model));
  }
  return [...new Set(diagnostics)].toSorted(compareText);
}

function assertEqual(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}\nexpected: ${JSON.stringify(expected)}\nactual: ${JSON.stringify(actual)}`);
  }
}

function withChangelogMutation(fixture, mutate, inspect) {
  const root = mkdtempSync(join(tmpdir(), 'zmdb-release-governance-'));
  try {
    cpSync(fixture, root, { recursive: true });
    const path = join(root, 'CHANGELOG.md');
    writeFileSync(path, mutate(readFileSync(path, 'utf8')));
    return inspect(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runSelfTest() {
  const fixtures = join(ROOT, 'scripts', 'architecture', '__fixtures__');
  const valid = join(fixtures, 'valid');
  const plan = releasePlan(valid);
  assertEqual('valid plan packages', plan.packages, ['@fixture/app', '@fixture/core']);
  assertEqual('valid plan order', plan.publishOrder, ['@fixture/core', '@fixture/app']);
  assertEqual('valid plan determinism', releasePlan(valid), plan);
  assertEqual('changelog drift', releaseGovernanceDiagnostics(join(fixtures, 'changelog-drift'), undefined, false), [
    '[RELEASE_CHANGELOG_MISSING] 1.0.0-alpha.4 at CHANGELOG.md: no unique non-empty version section exists. Remediation: add one non-empty exact version section.',
  ]);
  assertEqual('matching tag', releaseGovernanceDiagnostics(valid, 'v1.0.0-alpha.4', false), []);
  assertEqual('mismatched tag', releaseGovernanceDiagnostics(valid, 'v1.0.0-alpha.5', false), [
    '[RELEASE_TAG_MISMATCH] v1.0.0-alpha.5 against 1.0.0-alpha.4: triggering tag disagrees with the common package version. Remediation: tag the verified commit exactly v<version>.',
  ]);
  assertEqual(
    'unknown changelog owner',
    withChangelogMutation(
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
  assertEqual(
    'newest-first changelog order',
    withChangelogMutation(
      valid,
      source =>
        `${source.trim()}\n\n## [1.0.0-alpha.5] - 2026-09-06\n\n### Added\n\n- **product:** put a newer release after an older release.\n`,
      root => releaseGovernanceDiagnostics(root, undefined, false),
    ),
    [
      '[RELEASE_CHANGELOG_FORMAT] CHANGELOG.md: released version 1.0.0-alpha.5 is not older than the preceding section. Remediation: restore the one-project changelog shape in scripts/release/SPEC.md.',
    ],
  );
  console.log('Release governance self-test passed: 8 plan, changelog, order, determinism, owner, and tag cases.');
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

function main(argv) {
  const options = parseArguments(argv);
  if (options.selfTest) {
    runSelfTest();
    return;
  }
  const includeConsumers = existsSync(join(options.root, '.github', 'workflows', 'publish.yml'));
  const diagnostics = releaseGovernanceDiagnostics(options.root, options.tag, includeConsumers);
  if (diagnostics.length > 0) {
    for (const item of diagnostics) console.error(item);
    process.exitCode = 1;
    return;
  }
  const plan = releasePlan(options.root);
  console.log(
    `release governance: ${String(plan.packages.length)} packages at ${plan.version} in ${String(plan.publishOrder.length)} policy-derived publish steps.`,
  );
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(resolve(invoked)).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
