// Owned, expiring architecture exceptions.
//
// This module is the only authority for temporarily accepted governance debt.
// Verifiers still compute raw findings independently; this registry can only
// classify an exact code/scope pair and can never create or legalise a finding.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXCEPTION_SOURCES = Object.freeze([
  'database-boundaries',
  'runtime-foundation',
  'server-boundaries',
  'tooling-boundaries',
]);

const INTRODUCED = Object.freeze({
  'database-boundaries': Object.freeze({
    issue: 667,
    commit: '5ae7277c3a0e31cc3681953c509732a78a313491',
    evidence: Object.freeze(['.github/scripts/verify-database-boundaries.mjs']),
  }),
  'runtime-foundation': Object.freeze({
    issue: 636,
    commit: '13650e5d2ba3eaaa86bea359b0beaf754ce91774',
    evidence: Object.freeze([
      '.github/scripts/verify-runtime-foundation.mjs',
      '.github/scripts/verify-runtime-foundation.SPEC.md',
    ]),
  }),
  'server-boundaries': Object.freeze({
    issue: 655,
    commit: '2a4a53e7081cae5789c59c73e3b53a946ad83b66',
    evidence: Object.freeze(['.github/scripts/verify-server-boundaries.mjs']),
  }),
  'tooling-boundaries': Object.freeze({
    issue: 627,
    commit: 'e66621a5c025c252e0d3ae341ce0c11d64be6183',
    evidence: Object.freeze([
      '.github/scripts/verify-tooling-boundaries.mjs',
      '.github/scripts/verify-tooling-ownership.SPEC.md',
    ]),
  }),
});

const DATABASE_DEBT = Object.freeze([]);

const RUNTIME_OPTIONAL_DEBT = Object.freeze([
  ['@zmdb/ai', '@zmdb/schema-core', 'packages/ai/src/index.ts', '@zmdb/schema-core'],
  ['@zmdb/ai', '@zmdb/schema-core', 'packages/ai/src/tool-runtime.ts', '@zmdb/schema-core'],
  ['@zmdb/ai', '@zmdb/schema-core', 'packages/ai/src/providers.ts', '@zmdb/schema-core'],
  ['@zmdb/ai', '@zmdb/schema-core', 'packages/ai/src/providers.ts', '@zmdb/schema-core/ir'],
  ['@zmdb/ai', '@zmdb/schema-core', 'packages/ai/src/http/parse.ts', '@zmdb/schema-core/openapi'],
  ['@zmdb/ai', '@zmdb/query-compiler', 'packages/schema-core/src/openapi/index.ts', '@zmdb/query-compiler/naming'],
  ['@zmdb/ai', '@zmdb/query-compiler', 'packages/schema-core/src/relations/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/ai', '@zmdb/query-compiler', 'packages/schema-core/src/dto/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/repository', 'packages/sqlite/src/index.ts', '@zmdb/repository'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/sqlite/src/dialect.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/repository', 'packages/sqlite/src/driver.ts', '@zmdb/repository'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/sqlite/src/migrations.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/sqlite/src/migrations.ts', '@zmdb/query-compiler/schema-objects'],
  ['@zmdb/sqlite', '@zmdb/aot-validator', 'packages/repository/src/index.ts', '@zmdb/aot-validator/utilities'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/index.ts', '@zmdb/query-compiler/aggregations'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/index.ts', '@zmdb/query-compiler/fts'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/index.ts', '@zmdb/query-compiler/joins'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/index.ts', '@zmdb/query-compiler/schema-objects'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/index.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/index.ts', '@zmdb/schema-core/derive'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/index.ts', '@zmdb/schema-core/dto'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/index.ts', '@zmdb/schema-core/ir'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/index.ts', '@zmdb/schema-core/tags'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/aot-validator/src/utilities/index.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/aot-validator/src/utilities/index.ts', '@zmdb/schema-core/ir'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/schema-core/src/dto/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/cache/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/cache/index.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/cache/index.ts', '@zmdb/schema-core/ir'],
  ['@zmdb/sqlite', '@zmdb/aot-validator', 'packages/repository/src/filters/index.ts', '@zmdb/aot-validator/utilities'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/filters/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/filters/index.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/filters/index.ts', '@zmdb/schema-core/ir'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/loaders/index.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/loaders/index.ts', '@zmdb/schema-core/derive'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/repository/src/transactions/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/aot-validator/src/errors.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/aot-validator/src/regex-complexity.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/query-compiler', 'packages/schema-core/src/relations/index.ts', '@zmdb/query-compiler'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/validator.ts', '@zmdb/schema-core'],
  ['@zmdb/sqlite', '@zmdb/schema-core', 'packages/repository/src/validator.ts', '@zmdb/schema-core/ir'],
]);

const RUNTIME_LEGACY_IMPORT_DEBT = Object.freeze([
  [
    '@zmdb/aot-validator',
    [
      'packages/compiler/src/emit/index.ts',
      'packages/compiler/src/transform/index.ts',
      'packages/zmdb/src/validator.ts',
    ],
    640,
  ],
  ['@zmdb/aot-validator/advanced', ['packages/app/src/commands/index.ts', 'packages/zmdb/src/validator.ts'], 640],
  [
    '@zmdb/aot-validator/errors',
    ['packages/compiler/src/config/index.ts', 'packages/compiler/src/emit/__testing__/project.ts'],
    640,
  ],
  ['@zmdb/aot-validator/serialization', ['packages/zmdb/src/validator.ts'], 640],
  [
    '@zmdb/aot-validator/utilities',
    [
      'fixtures/consumer-compiler/src/model.ts',
      'packages/ai/src/http/generate.ts',
      'packages/compiler/src/config/index.zmdb.generated.js',
      'packages/compiler/src/config/index.zmdb.witness.ts',
      'packages/repository/src/filters/index.ts',
      'packages/repository/src/index.ts',
      'packages/repository/src/seeding/index.ts',
      'packages/zmdb/src/index.ts',
      'packages/zmdb/src/validator.ts',
    ],
    640,
  ],
  [
    '@zmdb/query-compiler',
    [
      'fixtures/database-cockroach/src/contracts.ts',
      'fixtures/database-cockroach/src/runtime.mjs',
      'fixtures/database-mssql/src/acceptance.mjs',
      'fixtures/database-mssql/src/contracts.ts',
      'fixtures/database-postgres/src/contracts.ts',
      'fixtures/database-postgres/src/runtime.mjs',
      'fixtures/database-singlestore/src/contracts.ts',
      'fixtures/database-singlestore/src/runtime.mjs',
      'packages/app/src/observability/index.ts',
      'packages/app/src/observability/types.ts',
      'packages/cockroach/src/index.ts',
      'packages/cockroach/src/introspect.ts',
      'packages/cockroach/src/migrations.ts',
      'packages/compiler/src/config/contract.ts',
      'packages/compiler/src/config/index.ts',
      'packages/jobs/src/queues/index.ts',
      'packages/migrations/src/declarations/emit.ts',
      'packages/migrations/src/declarations/tagged-property.ts',
      'packages/migrations/src/index.ts',
      'packages/migrations/src/introspect/common.ts',
      'packages/migrations/src/introspect/drift.ts',
      'packages/migrations/src/introspect/index.ts',
      'packages/migrations/src/operations/embed.ts',
      'packages/migrations/src/operations/generate.ts',
      'packages/migrations/src/project.ts',
      'packages/migrations/src/runner.ts',
      'packages/mssql/src/compiler.ts',
      'packages/mssql/src/driver.ts',
      'packages/mssql/src/index.ts',
      'packages/mssql/src/introspect.ts',
      'packages/mssql/src/migrations.ts',
      'packages/mssql/src/types.ts',
      'packages/mysql/src/dialect.ts',
      'packages/mysql/src/driver.ts',
      'packages/mysql/src/introspect.ts',
      'packages/mysql/src/migrations.ts',
      'packages/postgres/src/constants.ts',
      'packages/postgres/src/driver.ts',
      'packages/postgres/src/index.ts',
      'packages/postgres/src/introspect.ts',
      'packages/postgres/src/migrations.ts',
      'packages/repository/src/cache/index.ts',
      'packages/repository/src/filters/index.ts',
      'packages/repository/src/index.ts',
      'packages/repository/src/jobs/index.ts',
      'packages/repository/src/outbox/index.ts',
      'packages/repository/src/replicas/index.ts',
      'packages/repository/src/transactions/index.ts',
      'packages/repository/src/transactions/recording-conn.ts',
      'packages/schema-core/src/dto/index.ts',
      'packages/schema-core/src/relations/index.ts',
      'packages/singlestore/src/index.ts',
      'packages/singlestore/src/introspect.ts',
      'packages/singlestore/src/migrations.ts',
      'packages/sqlite/src/dialect.ts',
      'packages/sqlite/src/migrations.ts',
      'packages/zmdb/src/cli/database.ts',
      'packages/zmdb/src/cli/migration-project.ts',
      'packages/zmdb/src/sql.ts',
      'packages/zmdb/src/studio/index.ts',
    ],
    639,
  ],
  [
    '@zmdb/query-compiler/aggregations',
    ['packages/repository/src/index.ts', 'packages/zmdb/src/sql.ts', 'packages/zmdb/src/studio/index.ts'],
    639,
  ],
  [
    '@zmdb/query-compiler/fts',
    [
      'fixtures/database-postgres/src/runtime.mjs',
      'fixtures/database-singlestore/src/runtime.mjs',
      'packages/repository/src/index.ts',
      'packages/zmdb/src/sql.ts',
    ],
    639,
  ],
  ['@zmdb/query-compiler/joins', ['packages/repository/src/index.ts', 'packages/zmdb/src/sql.ts'], 639],
  [
    '@zmdb/query-compiler/naming',
    [
      'packages/migrations/src/declarations/emit.ts',
      'packages/schema-core/src/openapi/index.ts',
      'packages/zmdb/src/sql.ts',
    ],
    638,
  ],
  [
    '@zmdb/query-compiler/outbox',
    [
      'fixtures/database-postgres/src/runtime.mjs',
      'fixtures/database-singlestore/src/runtime.mjs',
      'packages/repository/src/outbox/index.ts',
      'packages/zmdb/src/orm.ts',
    ],
    641,
  ],
  [
    '@zmdb/query-compiler/schema-objects',
    [
      'packages/cockroach/src/migrations.ts',
      'packages/migrations/src/index.ts',
      'packages/mssql/src/migrations.ts',
      'packages/mysql/src/migrations.ts',
      'packages/postgres/src/migrations.ts',
      'packages/repository/src/index.ts',
      'packages/sqlite/src/migrations.ts',
      'packages/zmdb/src/sql.ts',
    ],
    639,
  ],
  ['@zmdb/query-compiler/set-ops', ['packages/zmdb/src/sql.ts'], 639],
  [
    '@zmdb/repository',
    [
      'fixtures/database-cockroach/src/contracts.ts',
      'fixtures/database-cockroach/src/runtime.mjs',
      'fixtures/database-mssql/src/contracts.ts',
      'fixtures/database-postgres/src/contracts.ts',
      'fixtures/database-singlestore/src/contracts.ts',
      'packages/app/src/data/index.ts',
      'packages/app/src/health/index.ts',
      'packages/app/src/observability/index.ts',
      'packages/cockroach/src/index.ts',
      'packages/mssql/src/driver.ts',
      'packages/mssql/src/index.ts',
      'packages/mysql/src/driver.ts',
      'packages/mysql/src/index.ts',
      'packages/postgres/src/driver.ts',
      'packages/postgres/src/index.ts',
      'packages/postgres/src/testing/fixture.ts',
      'packages/singlestore/src/index.ts',
      'packages/sqlite/src/driver.ts',
      'packages/sqlite/src/index.ts',
      'packages/zmdb/src/index.ts',
      'packages/zmdb/src/orm.ts',
      'packages/zmdb/src/studio/index.ts',
    ],
    641,
  ],
  ['@zmdb/repository/entity-modeling', ['packages/zmdb/src/orm.ts'], 641],
  ['@zmdb/repository/integrations', ['packages/zmdb/src/orm.ts'], 641],
  ['@zmdb/repository/jobs', ['packages/jobs/src/queues/backends/memory.ts', 'packages/zmdb/src/orm.ts'], 641],
  ['@zmdb/repository/outbox', ['packages/app/src/events/index.ts', 'packages/zmdb/src/orm.ts'], 641],
  ['@zmdb/repository/replicas', ['packages/zmdb/src/orm.ts'], 641],
  ['@zmdb/repository/seeding', ['packages/zmdb/src/orm.ts'], 641],
  ['@zmdb/repository/transactions', ['packages/app/src/cqrs/index.ts', 'packages/app/src/events/index.ts'], 641],
  [
    '@zmdb/schema-core',
    [
      'fixtures/llm-adapters/src/contracts.ts',
      'packages/ai/src/index.ts',
      'packages/ai/src/providers.ts',
      'packages/ai/src/tool-runtime.ts',
      'packages/aot-validator/src/advanced/index.ts',
      'packages/aot-validator/src/errors.ts',
      'packages/aot-validator/src/regex-complexity.ts',
      'packages/aot-validator/src/utilities/index.ts',
      'packages/app/src/data/index.ts',
      'packages/compiler/src/config/index.ts',
      'packages/compiler/src/reflect/index.ts',
      'packages/compiler/src/testing/index.ts',
      'packages/repository/src/cache/index.ts',
      'packages/repository/src/filters/index.ts',
      'packages/repository/src/index.ts',
      'packages/repository/src/integrations/index.ts',
      'packages/repository/src/loaders/index.ts',
      'packages/repository/src/outbox/index.ts',
      'packages/repository/src/seeding/index.ts',
      'packages/repository/src/validator.ts',
      'packages/web/src/data/index.ts',
      'packages/web/src/pipeline/index.ts',
      'packages/zmdb/src/index.ts',
      'packages/zmdb/src/schema.ts',
      'packages/zmdb/src/studio/index.ts',
    ],
    638,
  ],
  ['@zmdb/schema-core/custom-types', ['packages/zmdb/src/schema.ts'], 638],
  [
    '@zmdb/schema-core/derive',
    [
      'packages/repository/src/index.ts',
      'packages/repository/src/loaders/index.ts',
      'packages/zmdb/src/derive.ts',
      'packages/zmdb/src/schema.ts',
    ],
    638,
  ],
  [
    '@zmdb/schema-core/dto',
    ['packages/repository/src/index.ts', 'packages/zmdb/src/dto.ts', 'packages/zmdb/src/schema.ts'],
    638,
  ],
  [
    '@zmdb/schema-core/ir',
    [
      'packages/ai/src/providers.ts',
      'packages/aot-validator/src/utilities/index.ts',
      'packages/app/src/commands/index.ts',
      'packages/compiler/src/emit/__testing__/project.ts',
      'packages/compiler/src/emit/index.ts',
      'packages/compiler/src/protobuf/decode.ts',
      'packages/compiler/src/protobuf/descriptor.ts',
      'packages/compiler/src/protobuf/encode.ts',
      'packages/compiler/src/protobuf/grpc-ir.ts',
      'packages/compiler/src/reflect/index.ts',
      'packages/compiler/src/testing/index.ts',
      'packages/compiler/src/transform/index.ts',
      'packages/repository/src/cache/index.ts',
      'packages/repository/src/filters/index.ts',
      'packages/repository/src/index.ts',
      'packages/repository/src/outbox/index.ts',
      'packages/repository/src/seeding/index.ts',
      'packages/repository/src/validator.ts',
      'packages/web/src/contract/compiler/index.ts',
      'packages/web/src/contract/index.ts',
      'packages/web/src/data/index.ts',
      'packages/zmdb/src/ir.ts',
      'packages/zmdb/src/schema.ts',
      'packages/zmdb/src/studio/index.ts',
    ],
    638,
  ],
  [
    '@zmdb/schema-core/naming',
    [
      'packages/compiler/src/codegen/index.ts',
      'packages/compiler/src/config/contract.ts',
      'packages/compiler/src/config/index.ts',
      'packages/compiler/src/index.ts',
      'packages/compiler/src/reflect/index.ts',
      'packages/compiler/src/testing/index.ts',
      'packages/compiler/src/unplugin/index.ts',
      'packages/zmdb/src/schema.ts',
    ],
    638,
  ],
  [
    '@zmdb/schema-core/openapi',
    ['packages/ai/src/http/parse.ts', 'packages/zmdb/src/schema.ts', 'packages/zmdb/src/studio/index.ts'],
    638,
  ],
  ['@zmdb/schema-core/relations', ['packages/zmdb/src/relations.ts', 'packages/zmdb/src/studio/index.ts'], 638],
  [
    '@zmdb/schema-core/tags',
    [
      'fixtures/consumer-compiler/src/model.ts',
      'packages/compiler/src/emit/__testing__/project.ts',
      'packages/repository/src/dx/fixtures.ts',
      'packages/repository/src/index.ts',
      'packages/repository/src/jobs/index.ts',
      'packages/repository/src/orders-fixture.ts',
      'packages/repository/src/outbox/index.ts',
      'packages/repository/src/typed-methods/typed-methods.fixture.ts',
      'packages/repository/src/typed-populate/fixtures.ts',
      'packages/zmdb/src/index.ts',
      'packages/zmdb/src/schema.ts',
      'packages/zmdb/src/tags.ts',
    ],
    638,
  ],
]);

const RUNTIME_PACKAGES = Object.freeze([
  ['@zmdb/aot-validator', 640],
  ['@zmdb/query-compiler', 639],
  ['@zmdb/repository', 641],
  ['@zmdb/schema-core', 638],
]);

const RUNTIME_TARGET_PACKAGES = Object.freeze([
  ['@zmdb/orm', 'packages/orm/package.json', 641],
  ['@zmdb/schema', 'packages/schema/package.json', 638],
  ['@zmdb/sql', 'packages/sql/package.json', 639],
  ['@zmdb/validator', 'packages/validator/package.json', 640],
]);

const RETIRED_LEGACY_ENTRIES = Object.freeze([]);

const TOOLING_GENERATED_DEBT = Object.freeze([
  [
    'benchmarks/harness/framework/model.zmdb.generated.js',
    '../../../packages/aot-validator/src/utilities/index.js',
    'private-source',
    640,
  ],
  [
    'benchmarks/harness/framework/model.zmdb.witness.ts',
    '../../../packages/aot-validator/src/utilities/index.js',
    'private-source',
    640,
  ],
  [
    'benchmarks/harness/validation/model.generated.ts',
    '../../../packages/schema-core/src/ir/index.js',
    'private-source',
    638,
  ],
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function packageId(packageName) {
  return packageName.startsWith('@zmdb/') ? packageName.slice('@zmdb/'.length) : packageName;
}

function packageIdForPath(path) {
  return path.split('/')[1] ?? 'repository';
}

function canonicalScope(scope) {
  if (scope.kind === 'package') return scope.packageId;
  if (scope.kind === 'entry') return `${scope.packageId}:${scope.selector}`;
  if (scope.kind === 'edge') return `${scope.consumer}->${scope.dependency}`;
  if (scope.kind === 'path') return scope.path;
  if (scope.kind === 'issue') return String(scope.issue);
  throw new TypeError(`unknown governance scope kind: ${String(scope.kind)}`);
}

function safeScopeKey(scope) {
  try {
    return isRecord(scope) ? `${String(scope.kind)}\u0000${canonicalScope(scope)}` : 'invalid';
  } catch {
    return `invalid\u0000${JSON.stringify(scope)}`;
  }
}

function findingCode(id) {
  return id.split('/')[0] ?? '';
}

function findingId(code, scope) {
  return `${code}/${scope.kind}/${encodeURIComponent(canonicalScope(scope))}`;
}

function exceptionId(source, finding) {
  const slug = `${source}-${finding.code}-${canonicalScope(finding.scope)}`
    .toLowerCase()
    .replaceAll('@zmdb/', '')
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '');
  return `GEX-${slug}`;
}

function freeze(value) {
  if (!isRecord(value) && !Array.isArray(value)) return value;
  for (const child of Object.values(value)) freeze(child);
  return Object.freeze(value);
}

export function createGovernanceFinding({ code, scope, message, count = 1, remediation = '' }) {
  return freeze({
    id: findingId(code, scope),
    code,
    scope: freeze({ ...scope }),
    message,
    remediation,
    count,
  });
}

export function databaseBoundaryFinding(finding) {
  const code = `DATABASE_${String(finding.kind).toUpperCase().replaceAll('-', '_')}`;
  const scope =
    finding.kind === 'missing-package'
      ? { kind: 'package', packageId: packageId(finding.token) }
      : finding.kind === 'missing-packed-consumer'
        ? { kind: 'path', path: finding.path }
        : {
            kind: 'entry',
            packageId: packageIdForPath(finding.path),
            selector: `${finding.path}:${finding.token}`,
          };
  return createGovernanceFinding({
    code,
    scope,
    message: `${finding.kind}: ${finding.path} -> ${finding.token}`,
    count: finding.count,
    remediation: 'remove vendor ownership from the generic package or complete the selected database vertical',
  });
}

export function runtimeFoundationOptionalFinding({ target, reached, path, specifier }) {
  return createGovernanceFinding({
    code: 'RUNTIME_FOUNDATION_OPTIONAL_EDGE',
    scope: {
      kind: 'entry',
      packageId: packageId(target),
      selector: `${path}:${specifier}`,
    },
    message: `${target} reaches non-foundation workspace package ${reached} at ${path} through ${specifier}`,
    remediation: 'move the implementation to the optional package or depend only on the inward foundation contract',
  });
}

export function runtimeFoundationProblemFinding(problem) {
  let match = /^missing target package (@zmdb\/[^:]+): (.+)$/.exec(problem);
  if (match !== null) {
    return createGovernanceFinding({
      code: 'RUNTIME_FOUNDATION_PACKAGE_MISSING',
      scope: { kind: 'package', packageId: packageId(match[1]) },
      message: problem,
      remediation: 'complete the named foundation package extraction',
    });
  }

  match = /^old package still exists: (@zmdb\/.+)$/.exec(problem);
  if (match !== null) {
    return createGovernanceFinding({
      code: 'RUNTIME_FOUNDATION_LEGACY_PACKAGE',
      scope: { kind: 'package', packageId: packageId(match[1]) },
      message: problem,
      remediation: 'remove the legacy package after all consumers use its successor',
    });
  }

  match = /^old import (.+) remains in \[(.*)\]$/.exec(problem);
  if (match !== null) {
    const paths = (match[2] ?? '').split(', ').filter(Boolean);
    return createGovernanceFinding({
      code: 'RUNTIME_FOUNDATION_LEGACY_IMPORT',
      scope: {
        kind: 'entry',
        packageId: packageId((match[1] ?? '').split('/').slice(0, 2).join('/')),
        selector: match[1],
      },
      message: problem,
      count: paths.length,
      remediation: 'retarget each listed import to the owning foundation or tooling package',
    });
  }

  return createGovernanceFinding({
    code: 'RUNTIME_FOUNDATION_UNCLASSIFIED',
    scope: { kind: 'entry', packageId: 'runtime-foundation', selector: problem },
    message: problem,
    remediation: 'give this new finding a structured rule-specific identity before accepting it',
  });
}

export function serverBoundaryProblemFinding(problem) {
  if (problem.startsWith('zmdb is missing core server dependencies ')) {
    const count = problem
      .slice(problem.indexOf('[') + 1, problem.lastIndexOf(']'))
      .split(', ')
      .filter(Boolean).length;
    return createGovernanceFinding({
      code: 'SERVER_FACADE_DEPENDENCY_MISSING',
      scope: { kind: 'package', packageId: 'zmdb' },
      message: problem,
      count,
      remediation: 'make the product facade dependency policy match the current server composition contract',
    });
  }
  if (problem.startsWith('zmdb is missing core server facade subpaths ')) {
    const count = problem
      .slice(problem.indexOf('[') + 1, problem.lastIndexOf(']'))
      .split(', ')
      .filter(Boolean).length;
    return createGovernanceFinding({
      code: 'SERVER_FACADE_EXPORT_MISSING',
      scope: { kind: 'package', packageId: 'zmdb' },
      message: problem,
      count,
      remediation: 'publish the earned cohesive facade or remove the stale target from the server contract',
    });
  }
  return createGovernanceFinding({
    code: 'SERVER_BOUNDARY_UNCLASSIFIED',
    scope: { kind: 'entry', packageId: 'server-boundaries', selector: problem },
    message: problem,
    remediation: 'give this new finding a structured rule-specific identity before accepting it',
  });
}

export function toolingRuntimeFinding(violation) {
  return createGovernanceFinding({
    code: 'TOOLING_RUNTIME_REACHABILITY',
    scope: {
      kind: 'entry',
      packageId: packageId(violation.entry),
      selector: `${violation.source}:${violation.specifier}`,
    },
    message: violation.id,
    remediation: 'move compiler reachability behind the compiler package boundary',
  });
}

export function toolingGeneratedFinding(violation) {
  return createGovernanceFinding({
    code: 'TOOLING_GENERATED_IMPORT',
    scope: { kind: 'path', path: violation.path },
    message: `${violation.path}|${violation.specifier}|${violation.reason}`,
    remediation: 'emit a public runtime import rather than a tooling or private-source import',
  });
}

function record({ source, finding, legacyEntry, ownerIssue, rationale }) {
  return freeze({
    id: exceptionId(source, finding),
    findingId: finding.id,
    scope: finding.scope,
    rationale,
    introduced: INTRODUCED[source],
    ownerIssue,
    ceiling: { metric: 'finding-count', maximum: finding.count },
    removeWhen: { kind: 'finding-absent' },
    migration: {
      source,
      entry: legacyEntry,
    },
  });
}

function databaseRecords() {
  return DATABASE_DEBT.map(([kind, path, token, count, ownerIssue]) => {
    const finding = databaseBoundaryFinding({ kind, path, token, count });
    return record({
      source: 'database-boundaries',
      finding,
      legacyEntry: `${kind}|${path}|${token}|${String(count)}`,
      ownerIssue,
      rationale: `Issue #${String(ownerIssue)} removes this exact vendor-specific name from generic production code.`,
    });
  });
}

function runtimeRecords() {
  const optional = RUNTIME_OPTIONAL_DEBT.map(([target, reached, path, specifier]) => {
    const finding = runtimeFoundationOptionalFinding({ target, reached, path, specifier });
    return record({
      source: 'runtime-foundation',
      finding,
      legacyEntry: `${target} reaches non-foundation workspace package ${reached}`,
      ownerIssue: 637,
      rationale: 'Issue #637 removes this exact optional-integration path from the runtime foundation.',
    });
  });

  const missing = RUNTIME_TARGET_PACKAGES.map(([name, path, ownerIssue]) => {
    const legacyEntry = `missing target package ${name}: ${path}`;
    return record({
      source: 'runtime-foundation',
      finding: runtimeFoundationProblemFinding(legacyEntry),
      legacyEntry,
      ownerIssue,
      rationale: `Issue #${String(ownerIssue)} creates the named zero-dependency foundation package.`,
    });
  });

  const imports = RUNTIME_LEGACY_IMPORT_DEBT.map(([specifier, paths, ownerIssue]) => {
    const legacyEntry = `old import ${specifier} remains in [${paths.join(', ')}]`;
    return record({
      source: 'runtime-foundation',
      finding: runtimeFoundationProblemFinding(legacyEntry),
      legacyEntry,
      ownerIssue,
      rationale: `Issue #${String(ownerIssue)} owns the successor API and removes every listed legacy import.`,
    });
  });

  const packages = RUNTIME_PACKAGES.map(([name, ownerIssue]) => {
    const legacyEntry = `old package still exists: ${name}`;
    return record({
      source: 'runtime-foundation',
      finding: runtimeFoundationProblemFinding(legacyEntry),
      legacyEntry,
      ownerIssue,
      rationale: `Issue #${String(ownerIssue)} removes this legacy package after its consumers move.`,
    });
  });

  return [...optional, ...missing, ...imports, ...packages];
}

function toolingRecords() {
  return TOOLING_GENERATED_DEBT.map(([path, specifier, reason, ownerIssue]) => {
    const violation = { path, specifier, reason };
    return record({
      source: 'tooling-boundaries',
      finding: toolingGeneratedFinding(violation),
      legacyEntry: `${path}|${specifier}|${reason}`,
      ownerIssue,
      rationale: `Issue #${String(ownerIssue)} retargets generated application code to its public runtime package.`,
    });
  });
}

export const GOVERNANCE_EXCEPTIONS = freeze(
  [...databaseRecords(), ...runtimeRecords(), ...toolingRecords()].toSorted((left, right) =>
    `${left.migration.source}\u0000${left.findingId}\u0000${left.id}`.localeCompare(
      `${right.migration.source}\u0000${right.findingId}\u0000${right.id}`,
    ),
  ),
);

export function governanceExceptionsForSource(source, exceptions = GOVERNANCE_EXCEPTIONS) {
  return exceptions.filter(exception => exception.migration.source === source);
}

function diagnostic(code, exceptionIdValue, message) {
  return freeze({
    code,
    exceptionId: exceptionIdValue,
    message: `[${code}] ${message}`,
  });
}

function scopeProblems(scope) {
  if (!isRecord(scope) || typeof scope.kind !== 'string') return ['scope must be a structured governance scope'];
  const wildcard = value => typeof value !== 'string' || value.length === 0 || /[*?[\]{}]/.test(value);
  const prose = value => typeof value === 'string' && /\s/.test(value);
  if (scope.kind === 'package') {
    return wildcard(scope.packageId) || prose(scope.packageId) ? ['package scope must name one exact package id'] : [];
  }
  if (scope.kind === 'entry') {
    return wildcard(scope.packageId) || wildcard(scope.selector) || prose(scope.packageId) || prose(scope.selector)
      ? ['entry scope must name one exact package id and selector']
      : [];
  }
  if (scope.kind === 'edge') {
    return wildcard(scope.consumer) || wildcard(scope.dependency) || prose(scope.consumer) || prose(scope.dependency)
      ? ['edge scope must name one exact consumer and dependency']
      : [];
  }
  if (scope.kind === 'path') {
    if (wildcard(scope.path)) return ['path scope must name one exact repository-relative path'];
    if (scope.path.startsWith('/') || scope.path.split('/').includes('..') || scope.path.includes('\\')) {
      return ['path scope must be repository-relative POSIX text'];
    }
    return [];
  }
  if (scope.kind === 'issue') {
    return Number.isInteger(scope.issue) && scope.issue > 0 ? [] : ['issue scope must name one positive issue number'];
  }
  return [`unknown scope kind ${String(scope.kind)}`];
}

function sameScope(left, right) {
  try {
    return canonicalScope(left) === canonicalScope(right) && left.kind === right.kind;
  } catch {
    return false;
  }
}

function removeWhenSatisfied(removeWhen, observed, { root, packageGraph }) {
  if (!isRecord(removeWhen)) return false;
  if (removeWhen.kind === 'finding-absent') return observed === 0;
  if (removeWhen.kind === 'count-at-most') {
    return Number.isInteger(removeWhen.maximum) && observed <= removeWhen.maximum;
  }
  if (removeWhen.kind === 'path-absent') {
    return typeof root === 'string' && !existsSync(resolve(root, removeWhen.path));
  }
  if (removeWhen.kind === 'edge-absent') {
    return (
      packageGraph !== undefined &&
      typeof packageGraph.get === 'function' &&
      !(packageGraph.get(removeWhen.consumer) ?? []).includes(removeWhen.dependency)
    );
  }
  return false;
}

function removalConditionProblems(removeWhen) {
  if (!isRecord(removeWhen) || typeof removeWhen.kind !== 'string') {
    return ['removeWhen must name one explicit expiry condition'];
  }
  if (removeWhen.kind === 'finding-absent') return [];
  if (removeWhen.kind === 'count-at-most') {
    return Number.isInteger(removeWhen.maximum) && removeWhen.maximum >= 0
      ? []
      : ['count-at-most requires a non-negative integer maximum'];
  }
  if (removeWhen.kind === 'path-absent') {
    return scopeProblems({ kind: 'path', path: removeWhen.path });
  }
  if (removeWhen.kind === 'edge-absent') {
    return scopeProblems({
      kind: 'edge',
      consumer: removeWhen.consumer,
      dependency: removeWhen.dependency,
    });
  }
  return [`unknown removal condition ${String(removeWhen.kind)}`];
}

export function validateGovernanceExceptions({ exceptions, rawFindings, ownerStates, root, packageGraph }) {
  const diagnostics = [];
  const acceptedExceptionIds = new Set();
  const duplicateFindingKeys = new Map();
  const duplicateIds = new Map();
  for (const exception of exceptions) {
    const key = `${exception.findingId}\u0000${safeScopeKey(exception.scope)}`;
    duplicateFindingKeys.set(key, [...(duplicateFindingKeys.get(key) ?? []), exception]);
    duplicateIds.set(exception.id, [...(duplicateIds.get(exception.id) ?? []), exception]);
  }
  const duplicateExceptions = new Set([...duplicateFindingKeys.values()].filter(records => records.length > 1).flat());

  const matchedRawFindings = new Set();
  const reportedDuplicateFindings = new Set();
  const reportedDuplicateIds = new Set();
  for (const exception of exceptions) {
    if (duplicateExceptions.has(exception)) {
      const code = findingCode(exception.findingId);
      for (const finding of rawFindings) {
        if (finding.code === code && sameScope(finding.scope, exception.scope)) matchedRawFindings.add(finding);
      }
      const duplicateKey = `${exception.findingId}\u0000${safeScopeKey(exception.scope)}`;
      if (!reportedDuplicateFindings.has(duplicateKey)) {
        reportedDuplicateFindings.add(duplicateKey);
        diagnostics.push(
          diagnostic(
            'GOV_EXCEPTION_DUPLICATE_FINDING',
            exception.id,
            `${exception.findingId} and its exact scope are owned by more than one exception`,
          ),
        );
      }
      continue;
    }
    if ((duplicateIds.get(exception.id)?.length ?? 0) > 1) {
      if (!reportedDuplicateIds.has(exception.id)) {
        reportedDuplicateIds.add(exception.id);
        diagnostics.push(
          diagnostic('GOV_EXCEPTION_DUPLICATE_ID', exception.id, `${exception.id} is assigned more than once`),
        );
      }
      continue;
    }

    const problems = scopeProblems(exception.scope);
    if (problems.length > 0) {
      diagnostics.push(diagnostic('GOV_EXCEPTION_SCOPE_INVALID', exception.id, problems.join('; ')));
      continue;
    }
    if (typeof exception.id !== 'string' || !/^GEX-[a-z0-9][a-z0-9-]*$/.test(exception.id)) {
      diagnostics.push(
        diagnostic('GOV_EXCEPTION_ID_INVALID', String(exception.id), 'id must be a stable GEX-lowercase-slug'),
      );
      continue;
    }
    if (
      typeof exception.findingId !== 'string' ||
      exception.findingId !== findingId(findingCode(exception.findingId), exception.scope)
    ) {
      diagnostics.push(
        diagnostic(
          'GOV_EXCEPTION_FINDING_ID_MISMATCH',
          exception.id,
          'findingId must be derived from the exact rule code and canonical scope',
        ),
      );
      continue;
    }
    const code = findingCode(exception.findingId);
    const matching = rawFindings.filter(finding => finding.code === code && sameScope(finding.scope, exception.scope));
    for (const finding of matching) matchedRawFindings.add(finding);
    if (typeof exception.rationale !== 'string' || exception.rationale.trim().length < 16) {
      diagnostics.push(
        diagnostic('GOV_EXCEPTION_RATIONALE_MISSING', exception.id, 'rationale must explain why the debt remains'),
      );
      continue;
    }
    if (!Number.isInteger(exception.ownerIssue) || exception.ownerIssue <= 0) {
      diagnostics.push(
        diagnostic('GOV_EXCEPTION_OWNER_MISSING', exception.id, 'ownerIssue must name one positive issue number'),
      );
      continue;
    }
    if (ownerStates !== undefined) {
      const state = ownerStates[String(exception.ownerIssue)] ?? ownerStates[exception.ownerIssue];
      if (state === undefined) {
        diagnostics.push(
          diagnostic(
            'GOV_EXCEPTION_OWNER_MISSING',
            exception.id,
            `owner issue #${String(exception.ownerIssue)} is absent from the supplied complete issue snapshot`,
          ),
        );
        continue;
      }
      if (state !== 'OPEN') {
        diagnostics.push(
          diagnostic(
            'GOV_EXCEPTION_OWNER_CLOSED',
            exception.id,
            `owner issue #${String(exception.ownerIssue)} is ${String(state)} while the finding remains`,
          ),
        );
        continue;
      }
    }
    const introduced = exception.introduced;
    if (
      !isRecord(introduced) ||
      !Number.isInteger(introduced.issue) ||
      introduced.issue <= 0 ||
      typeof introduced.commit !== 'string' ||
      !/^[0-9a-f]{40}$/.test(introduced.commit) ||
      !Array.isArray(introduced.evidence) ||
      introduced.evidence.length === 0
    ) {
      diagnostics.push(
        diagnostic(
          'GOV_EXCEPTION_EVIDENCE_INVALID',
          exception.id,
          'introduced evidence requires an issue, full commit id, and evidence paths',
        ),
      );
      continue;
    }
    const evidence = new Set();
    let evidenceProblem;
    for (const path of introduced.evidence) {
      if (typeof path !== 'string' || path.length === 0 || path.startsWith('/') || path.includes('\\')) {
        evidenceProblem = 'evidence paths must be repository-relative POSIX paths';
        break;
      }
      if (evidence.has(path)) {
        evidenceProblem = `evidence path ${path} is duplicated`;
        break;
      }
      evidence.add(path);
      if (root !== undefined && !existsSync(resolve(root, path))) {
        evidenceProblem = `evidence path ${path} does not exist below the supplied root`;
        break;
      }
    }
    if (evidenceProblem !== undefined) {
      diagnostics.push(diagnostic('GOV_EXCEPTION_EVIDENCE_INVALID', exception.id, evidenceProblem));
      continue;
    }
    const maximum = exception.ceiling?.maximum;
    if (exception.ceiling?.metric !== 'finding-count' || !Number.isInteger(maximum) || maximum <= 0) {
      diagnostics.push(
        diagnostic('GOV_EXCEPTION_CEILING_INVALID', exception.id, 'ceiling must be a positive finding-count'),
      );
      continue;
    }
    const removalProblems = removalConditionProblems(exception.removeWhen);
    if (removalProblems.length > 0) {
      diagnostics.push(diagnostic('GOV_EXCEPTION_REMOVAL_CONDITION_INVALID', exception.id, removalProblems.join('; ')));
      continue;
    }

    const observed = matching.reduce(
      (total, finding) => total + (Number.isInteger(finding.count) && finding.count > 0 ? finding.count : 1),
      0,
    );
    if (observed === 0) {
      diagnostics.push(
        diagnostic('GOV_EXCEPTION_FINDING_ABSENT', exception.id, `delete ${exception.id}; its finding disappeared`),
      );
      continue;
    }
    if (!matching.some(finding => finding.id === exception.findingId)) {
      diagnostics.push(
        diagnostic(
          'GOV_EXCEPTION_FINDING_ID_MISMATCH',
          exception.id,
          `the exact scope still has ${String(observed)} finding(s), but ${exception.findingId} is absent`,
        ),
      );
      continue;
    }
    if (removeWhenSatisfied(exception.removeWhen, observed, { root, packageGraph })) {
      diagnostics.push(
        diagnostic(
          'GOV_EXCEPTION_REMOVAL_DUE',
          exception.id,
          `delete ${exception.id}; its explicit removal condition is satisfied`,
        ),
      );
      continue;
    }
    if (observed > maximum) {
      diagnostics.push(
        diagnostic(
          'GOV_EXCEPTION_CEILING_EXCEEDED',
          exception.id,
          `${exception.id} measured ${String(observed)} finding(s), above ceiling ${String(maximum)}`,
        ),
      );
      continue;
    }
    if (observed < maximum) {
      diagnostics.push(
        diagnostic(
          'GOV_EXCEPTION_CEILING_RAISED',
          exception.id,
          `lower ${exception.id} ceiling from ${String(maximum)} to measured ${String(observed)}`,
        ),
      );
      continue;
    }
    acceptedExceptionIds.add(exception.id);
  }

  for (const finding of rawFindings) {
    if (!matchedRawFindings.has(finding)) {
      diagnostics.push(
        diagnostic(
          'GOV_EXCEPTION_UNOWNED_FINDING',
          finding.id,
          `${finding.id} has no exact owned exception; fix it or add a reviewed record`,
        ),
      );
    }
  }

  return freeze({
    diagnostics: diagnostics.toSorted((left, right) =>
      `${left.code}\u0000${left.exceptionId}\u0000${left.message}`.localeCompare(
        `${right.code}\u0000${right.exceptionId}\u0000${right.message}`,
      ),
    ),
    findings: rawFindings.map(finding => {
      const exception = exceptions.find(
        candidate =>
          acceptedExceptionIds.has(candidate.id) &&
          finding.id === candidate.findingId &&
          finding.code === findingCode(candidate.findingId) &&
          sameScope(finding.scope, candidate.scope),
      );
      return freeze({
        ...finding,
        disposition: exception === undefined ? 'active' : 'excepted',
        ...(exception === undefined ? {} : { exceptionId: exception.id }),
      });
    }),
  });
}

export function verifyGovernanceExceptionSource({
  source,
  rawFindings,
  ownerStates,
  root = MODULE_ROOT,
  packageGraph,
  exceptions = GOVERNANCE_EXCEPTIONS,
}) {
  return validateGovernanceExceptions({
    exceptions: governanceExceptionsForSource(source, exceptions),
    rawFindings,
    ownerStates,
    root,
    packageGraph,
  });
}

export function ownerStatesFromGovernanceSnapshot(snapshot) {
  if (!isRecord(snapshot) || !Object.hasOwn(snapshot, 'issues')) {
    throw new TypeError('governance snapshot must expose its issues adapter');
  }
  if (snapshot.issues === null) return undefined;
  if (typeof snapshot.issues?.entries !== 'function') {
    throw new TypeError('governance snapshot issues must be a read-only map');
  }
  return freeze(
    Object.fromEntries(
      [...snapshot.issues.entries()]
        .map(([number, issue]) => {
          if (!Number.isInteger(number) || number <= 0 || !isRecord(issue)) {
            throw new TypeError('governance snapshot issue entries require positive numbers and records');
          }
          if (issue.state !== 'OPEN' && issue.state !== 'CLOSED') {
            throw new TypeError(
              `governance snapshot issue #${String(number)} has invalid state ${String(issue.state)}`,
            );
          }
          return [String(number), issue.state];
        })
        .toSorted(([left], [right]) => Number(left) - Number(right)),
    ),
  );
}

export function verifyGovernanceSnapshotExceptionSource({
  snapshot,
  source,
  rawFindings,
  exceptions,
  requireOwnerStates = true,
}) {
  if (!isRecord(snapshot) || typeof snapshot.root !== 'string') {
    throw new TypeError('verifyGovernanceSnapshotExceptionSource requires a governance snapshot with an explicit root');
  }
  const registry = exceptions ?? snapshot.exceptions;
  if (!Array.isArray(registry)) {
    throw new TypeError('governance snapshot must expose its structured exceptions');
  }
  const ownerStates = ownerStatesFromGovernanceSnapshot(snapshot);
  if (ownerStates === undefined && requireOwnerStates) {
    return freeze({
      diagnostics: [
        diagnostic(
          'GOV_EXCEPTION_RELATIONSHIPS_REQUIRED',
          source,
          `${source} exception ownership requires a complete native issue snapshot`,
        ),
      ],
      findings: rawFindings.map(finding => freeze({ ...finding, disposition: 'active' })),
    });
  }
  return verifyGovernanceExceptionSource({
    source,
    rawFindings,
    ownerStates,
    root: snapshot.root,
    packageGraph: snapshot.packageGraph,
    exceptions: registry,
  });
}

function markdownCell(value) {
  return `\`${String(value).replaceAll('|', '\\|').replaceAll('`', '\\`')}\``;
}

export function renderGovernanceExceptionMigrationReport(
  exceptions = GOVERNANCE_EXCEPTIONS,
  retiredEntries = RETIRED_LEGACY_ENTRIES,
) {
  const counts = Object.groupBy(exceptions, exception => exception.migration.source);
  const retiredCounts = Object.groupBy(retiredEntries, entry => entry.source);
  const lines = [
    '# Architecture exception migration report',
    '',
    'This deterministic report accounts for every former opaque entry: live findings map to owned structured exceptions, while entries already retired before migration remain explicit evidence rows.',
    '',
    ...EXCEPTION_SOURCES.map(
      source =>
        `- ${source}: ${String(counts[source]?.length ?? 0)} live, ` +
        `${String(retiredCounts[source]?.length ?? 0)} retired`,
    ),
    `- total legacy entries: ${String(exceptions.length + retiredEntries.length)}`,
    `- total live exceptions: ${String(exceptions.length)}`,
    `- total retired entries: ${String(retiredEntries.length)}`,
    '',
    '| Former source | Former entry | Exception | Raw finding | Owner | Ceiling |',
    '| --- | --- | --- | --- | ---: | ---: |',
    ...exceptions.map(
      exception =>
        `| ${markdownCell(exception.migration.source)} | ${markdownCell(exception.migration.entry)} | ` +
        `${markdownCell(exception.id)} | ${markdownCell(exception.findingId)} | #${String(exception.ownerIssue)} | ` +
        `${String(exception.ceiling.maximum)} |`,
    ),
    ...retiredEntries.map(
      entry =>
        `| ${markdownCell(entry.source)} | ${markdownCell(entry.entry)} | ` +
        `${markdownCell(`retired by #${String(entry.retiredBy)}`)} | ${markdownCell(entry.evidence)} | — | 0 |`,
    ),
    '',
  ];
  return lines.join('\n');
}

export function architectureExceptionInventory(
  exceptions = GOVERNANCE_EXCEPTIONS,
  retiredEntries = RETIRED_LEGACY_ENTRIES,
) {
  const grouped = Object.groupBy(exceptions, exception => exception.migration.source);
  const retiredGrouped = Object.groupBy(retiredEntries, entry => entry.source);
  return freeze({
    total: exceptions.length,
    bySource: Object.freeze(
      Object.fromEntries(EXCEPTION_SOURCES.map(source => [source, grouped[source]?.length ?? 0])),
    ),
    owners: Object.freeze([...new Set(exceptions.map(exception => exception.ownerIssue))].toSorted((a, b) => a - b)),
    ceiling: exceptions.reduce((total, exception) => total + exception.ceiling.maximum, 0),
    migration: freeze({
      legacyTotal: exceptions.length + retiredEntries.length,
      retiredTotal: retiredEntries.length,
      retiredBySource: Object.freeze(
        Object.fromEntries(EXCEPTION_SOURCES.map(source => [source, retiredGrouped[source]?.length ?? 0])),
      ),
    }),
  });
}

function cli() {
  const [argument] = process.argv.slice(2);
  if (argument === '--migration-report') {
    process.stdout.write(renderGovernanceExceptionMigrationReport());
    return;
  }
  if (argument === '--json') {
    process.stdout.write(`${JSON.stringify(GOVERNANCE_EXCEPTIONS, null, 2)}\n`);
    return;
  }
  const inventory = architectureExceptionInventory();
  process.stdout.write(
    `architecture exceptions: ${String(inventory.total)} owned record(s), ` +
      `${String(inventory.ceiling)} measured finding occurrence(s), owners ` +
      `${inventory.owners.map(issue => `#${String(issue)}`).join(', ')}; ` +
      `${String(inventory.migration.retiredTotal)} retired legacy row(s) accounted for.\n`,
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli();
}
