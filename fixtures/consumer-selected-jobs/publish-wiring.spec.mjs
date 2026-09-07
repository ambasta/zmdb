import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
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

const path = resolve(import.meta.dirname, '../../.github/scripts/verify-publish.mjs');
const production = await readFile(path, 'utf8');

async function wiring(source = production) {
  const directory = await mkdtemp(resolve(import.meta.dirname, '../../../selected-jobs-publish-control-'));
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
    assert(ast !== undefined, 'publish-wiring parser did not load its source');
    assert.equal(program.getSyntacticDiagnostics(entry).length, 0, 'publish-wiring source has syntax errors');
    return inspect(ast);
  } finally {
    api.close();
    await rm(directory, { recursive: true, force: true });
  }
}

function inspect(ast) {
  const imported = ast.statements.find(
    statement =>
      isImportDeclaration(statement) &&
      statement.moduleSpecifier.text === '../../fixtures/consumer-selected-jobs/qualify.mjs',
  );
  const names = imported?.importClause?.namedBindings;
  const entry =
    names !== undefined && isNamedImports(names)
      ? names.elements.find(element => (element.propertyName ?? element.name).text === 'qualifySelectedJobs')
      : undefined;
  const callStatementIndex = ast.statements.findIndex(
    statement =>
      isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        declaration =>
          declaration.initializer !== undefined &&
          isAwaitExpression(declaration.initializer) &&
          isCallExpression(declaration.initializer.expression) &&
          declaration.initializer.expression.expression.getText(ast) === entry?.name.text,
      ),
  );
  assert.notEqual(callStatementIndex, -1, 'publish entrypoint does not await selected jobs qualification');
  const declaration = ast.statements[callStatementIndex].declarationList.declarations.find(
    item => item.initializer !== undefined && isAwaitExpression(item.initializer),
  );
  assert(isIdentifier(declaration.name), 'qualification report must have an inspectable local binding');
  const guard = ast.statements[callStatementIndex + 1];
  assert(guard !== undefined && isIfStatement(guard), 'publish must immediately check its qualification report');
  return { binding: declaration.name.text, guard: guard.getText(ast) };
}

await test('[RF757-C07] the publish-wiring inspector extracts and executes an awaited report guard', async () => {
  const { binding, guard } = await wiring(
    `import { qualifySelectedJobs } from '../../fixtures/consumer-selected-jobs/qualify.mjs';
const result = await qualifySelectedJobs({});
if (!result.cleaned || result.failures.length > 0) fail('qualification refused');`,
  );
  const failures = [];
  for (const cleaned of [true, false]) {
    runInNewContext(
      guard,
      { [binding]: { cleaned, failures: [] }, fail: message => failures.push(message) },
      { timeout: 1000 },
    );
  }
  assert.deepEqual(failures, ['qualification refused']);
});

await test('[RF757-T01] publish awaits the packed selected-jobs lane and propagates every unsuccessful result', async () => {
  const { binding, guard } = await wiring();
  const valid = {
    cleaned: true,
    failures: [],
    consumers: [{ lane: 'default' }, { lane: 'sqlite' }, { lane: 'postgres' }],
  };
  const cases = [
    { report: valid, failures: 0 },
    { report: { ...valid, cleaned: false }, failures: 1 },
    { report: { ...valid, failures: ['installed consumer failed'] }, failures: 1 },
    { report: { ...valid, consumers: valid.consumers.slice(0, 2) }, failures: 1 },
    { report: { ...valid, consumers: [valid.consumers[0], valid.consumers[1], valid.consumers[1]] }, failures: 1 },
    { report: { ...valid, consumers: [valid.consumers[0], valid.consumers[1], { lane: 'unexpected' }] }, failures: 1 },
  ];
  for (const cell of cases) {
    const failures = [];
    runInNewContext(guard, { [binding]: cell.report, fail: message => failures.push(message) }, { timeout: 1000 });
    assert.equal(failures.length, cell.failures, `publish gate lost result ${JSON.stringify(cell.report)}`);
  }
});
