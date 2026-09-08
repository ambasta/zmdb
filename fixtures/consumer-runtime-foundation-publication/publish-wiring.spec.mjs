import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

import {
  isAwaitExpression,
  isCallExpression,
  isIdentifier,
  isIfStatement,
  isImportDeclaration,
  isNamedImports,
  isVariableStatement,
} from 'typescript/unstable/ast/is';
import { API } from 'typescript/unstable/sync';

const root = resolve(import.meta.dirname, '../..');
const production = await readFile(join(root, '.github/scripts/verify-publish.mjs'), 'utf8');
const lanes = ['schema', 'sql', 'validator', 'orm', 'application', 'generated'];

async function inspect(source = production) {
  const directory = await mkdtemp(resolve(import.meta.dirname, '../../../foundation-publish-control-'));
  const entry = join(directory, 'entry.mjs');
  const config = join(directory, 'tsconfig.json');
  const api = new API({ cwd: directory });
  try {
    await writeFile(entry, source);
    await writeFile(
      config,
      JSON.stringify({
        compilerOptions: { allowJs: true, noResolve: true, noLib: true, types: [] },
        files: ['entry.mjs'],
      }),
    );
    const program = api.updateSnapshot({ openProjects: [config] }).getProjects()[0]?.program;
    const ast = program?.getSourceFile(entry);
    assert(ast, 'publication parser did not load its source');
    assert.equal(program.getSyntacticDiagnostics(entry).length, 0);
    const imported = ast.statements.find(
      statement =>
        isImportDeclaration(statement) &&
        statement.moduleSpecifier.text === '../../fixtures/consumer-runtime-foundation/verify-installed.mjs',
    );
    const names = imported?.importClause?.namedBindings;
    const name =
      names && isNamedImports(names)
        ? names.elements.find(element => (element.propertyName ?? element.name).text === 'qualifyRuntimeFoundation')
            ?.name.text
        : undefined;
    const allCalls = [];
    const visit = node => {
      if (isCallExpression(node) && node.expression.getText(ast) === name) allCalls.push(node);
      node.forEachChild(child => {
        visit(child);
      });
    };
    visit(ast);
    const calls = ast.statements.flatMap((statement, index) => {
      if (!isVariableStatement(statement)) return [];
      return statement.declarationList.declarations
        .filter(declaration => {
          const initializer = declaration.initializer;
          return (
            initializer &&
            isAwaitExpression(initializer) &&
            isCallExpression(initializer.expression) &&
            initializer.expression.expression.getText(ast) === name
          );
        })
        .map(declaration => ({ declaration, index }));
    });
    const strict = ast.statements.filter(
      statement =>
        isIfStatement(statement) && statement.expression.getText(ast).includes('verify-runtime-foundation.mjs'),
    );
    return {
      totalCalls: allCalls.length,
      calls: calls.map(({ declaration, index }) => {
        assert(isIdentifier(declaration.name));
        const guard = ast.statements[index + 1];
        assert(guard && isIfStatement(guard), 'foundation result must be checked immediately');
        return {
          binding: declaration.name.text,
          guard: guard.getText(ast),
          arguments: declaration.initializer.expression.arguments.map(argument => argument.getText(ast)),
        };
      }),
      strict: strict.map(statement => statement.getText(ast)),
    };
  } finally {
    api.close();
    await rm(directory, { recursive: true, force: true });
  }
}

await test('the inspector recognizes an executable mandatory boundary and awaited consumer guard', async () => {
  const result = await inspect(`
import { qualifyRuntimeFoundation } from '../../fixtures/consumer-runtime-foundation/verify-installed.mjs';
if (run(process.execPath, [join(ROOT, '.github/scripts/verify-runtime-foundation.mjs'), '--strict'], { cwd: ROOT }).status !== 0) {
  throw new Error('foundation verification failed');
}
const report = await qualifyRuntimeFoundation({ tarballs, evidence });
if (!report.cleaned || report.failures.length > 0) fail('foundation consumer failed');
`);
  assert.equal(result.strict.length, 1);
  assert.equal(result.totalCalls, 1);
  assert.equal(result.calls.length, 1);
  const [{ binding, guard }] = result.calls;
  const failures = [];
  runInNewContext(
    guard,
    { [binding]: { cleaned: false, failures: [] }, fail: message => failures.push(message) },
    { timeout: 1000 },
  );
  assert.deepEqual(failures, ['foundation consumer failed']);
});

await test('the inspector counts bare and unawaited duplicate qualifier calls', async () => {
  const result = await inspect(`
import { qualifyRuntimeFoundation } from '../../fixtures/consumer-runtime-foundation/verify-installed.mjs';
const report = await qualifyRuntimeFoundation({});
if (!report.cleaned) fail('cleanup');
qualifyRuntimeFoundation({});
const unawaited = qualifyRuntimeFoundation({});
`);
  assert.equal(result.totalCalls, 3);
  assert.equal(result.calls.length, 1);
});

await test('publication awaits the real foundation qualifier exactly once and rejects incomplete evidence', async () => {
  const { calls, totalCalls } = await inspect();
  assert.equal(totalCalls, 1, 'publish must call runtime foundation qualification exactly once');
  assert.equal(calls.length, 1, 'publish must await exactly one runtime foundation qualification');
  const [{ binding, guard }] = calls;
  const valid = { cleaned: true, failures: [], consumers: lanes.map(lane => ({ lane })) };
  const cases = [
    valid,
    { ...valid, cleaned: false },
    { ...valid, failures: ['consumer failed'] },
    ...lanes.flatMap((lane, index) => [
      { ...valid, consumers: valid.consumers.filter(consumer => consumer.lane !== lane) },
      {
        ...valid,
        consumers: valid.consumers.map(consumer => (consumer.lane === lane ? { lane: 'unexpected' } : consumer)),
      },
      {
        ...valid,
        consumers: valid.consumers.map(consumer =>
          consumer.lane === lane ? valid.consumers[(index + 1) % lanes.length] : consumer,
        ),
      },
    ]),
    { ...valid, consumers: [...valid.consumers, valid.consumers[0]] },
    { ...valid, consumers: [...valid.consumers, { lane: 'unexpected' }] },
  ];
  for (const [index, report] of cases.entries()) {
    const failures = [];
    runInNewContext(guard, { [binding]: report, fail: message => failures.push(message) }, { timeout: 1000 });
    assert.equal(failures.length, index === 0 ? 0 : 1, `publication accepted ${JSON.stringify(report)}`);
  }
});

await test('publication forwards its actual archive records and outside-workspace evidence', async () => {
  const { calls } = await inspect();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].arguments.length, 1);
  const catalog = [
    { id: 'schema', npmName: '@zmdb/schema' },
    { id: 'sql', npmName: '@zmdb/sql' },
  ];
  const manifests = new Map(catalog.map(record => [record.id, { name: record.npmName, version: '1.0.0-test.0' }]));
  const archives = new Map(catalog.map(record => [record.npmName, `/packed/${record.id}.tgz`]));
  const tmp = resolve(root, '../publication-owned-proof');
  const handoff = runInNewContext(
    `(${calls[0].arguments[0]})`,
    {
      PUBLISH_PACKAGES: catalog,
      packedTarballs: archives,
      readManifest: (id, packages) => {
        assert.equal(packages, catalog);
        return manifests.get(id);
      },
      publishManifest: manifest => manifest,
      tmp,
      ROOT: root,
      join,
    },
    { timeout: 1000 },
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(handoff.tarballs)),
    catalog.map(record => ({
      manifest: manifests.get(record.id),
      tarball: archives.get(record.npmName),
    })),
  );
  assert.equal(typeof handoff.evidence, 'string');
  assert(relative(root, resolve(handoff.evidence)).startsWith('..'), 'evidence must be outside the workspace');
  assert.equal(resolve(handoff.evidence), join(tmp, 'runtime-foundation-evidence'));
});

await test('publication makes the strict source and declaration foundation verifier fatal', async () => {
  const { strict } = await inspect();
  assert.equal(strict.length, 1, 'publication must run exactly one mandatory strict foundation verifier');
  for (const status of [0, 1, null]) {
    const run = (command, args, options) => {
      assert.equal(command, process.execPath);
      assert.deepEqual(Array.from(args), [join(root, '.github/scripts/verify-runtime-foundation.mjs'), '--strict']);
      assert.equal(options.cwd, root);
      return { status };
    };
    const execute = () =>
      runInNewContext(strict[0], { run, process: { execPath: process.execPath }, ROOT: root, join }, { timeout: 1000 });
    if (status === 0) assert.doesNotThrow(execute);
    else assert.throws(execute, /foundation/i);
  }
});

await test('both mandatory CI and release publication steps execute the same enforced entrypoint', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(
    manifest.scripts['verify:publish'],
    'yarn verify:package-metadata && node .github/scripts/verify-publish.mjs',
  );
  for (const file of ['ci.yml', 'publish.yml']) {
    const source = await readFile(join(root, '.github/workflows', file), 'utf8');
    const steps = source.split(/\n\s+- name:/).slice(1);
    const gate = steps.filter(step => /^\s*run: yarn verify:publish\s*$/m.test(step));
    assert.equal(gate.length, 1, `${file} must execute the enforced publication entrypoint once`);
    assert.doesNotMatch(gate[0], /^\s*(?:continue-on-error|if):/m, `${file} must not make publication optional`);
  }
});
