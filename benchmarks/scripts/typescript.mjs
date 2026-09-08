#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { API } from 'typescript/unstable/sync';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const TYPESCRIPT = new URL(import.meta.resolve('typescript/package.json'));
const { default: getExePath } = await import(new URL('./lib/getExePath.js', TYPESCRIPT));
const COMPILER = getExePath();
const read = path => readFileSync(path, 'utf8');
const configurations = {
  product: ['consumer-product', 'tsconfig.consumer.json'],
  server: ['consumer-server-core', 'tsconfig.documented.json'],
};

function editor(project, config, file) {
  const original = read(file);
  const results = [];
  let api;
  let loaded;
  const measure = (operation, action) => {
    const start = performance.now();
    const response = action();
    results.push({ operation, elapsedMs: performance.now() - start, response });
    return response;
  };
  const diagnostics = expected => {
    const values = [...loaded.program.getSyntacticDiagnostics(file), ...loaded.program.getSemanticDiagnostics(file)];
    assert.deepEqual(values.map(value => value.code).toSorted(), expected);
    return values.map(value => ({
      code: value.code,
      start: value.start,
      length: value.length,
      message: value.messageText,
    }));
  };
  const edit = source => {
    writeFileSync(file, source);
    loaded = api.updateSnapshot({ fileChanges: { changed: [file] } }).getProject(config);
    assert(loaded, 'The edited consumer project must remain loaded');
  };
  try {
    measure('load', () => {
      api = new API({ cwd: project });
      const snapshot = api.updateSnapshot({ openProjects: [config], openFiles: [file] });
      loaded = snapshot.getProject(config);
      assert(loaded?.program.getSourceFile(file), 'The consumer editor input must be loaded');
      return { project: loaded.configFileName, files: loaded.program.getSourceFileNames() };
    });
    measure('diagnostics', () => diagnostics([]));
    measure('completion', () => {
      const completion = loaded.checker.getCompletionsAtPosition(
        file,
        original.indexOf('draft.name') + 'draft.'.length,
      );
      const names = completion?.entries.map(entry => entry.name) ?? [];
      assert(names.includes('name'), 'Completion must include the public DTO name field');
      return names;
    });
    measure('quickInfo', () => {
      const type = loaded.checker.getTypeAtPosition(file, original.indexOf('draft:'));
      assert(type, 'Quick info must resolve the public DTO');
      const properties = loaded.checker.getPropertiesOfType(type).map(symbol => {
        const property = loaded.checker.getTypeOfSymbol(symbol);
        return { name: symbol.name, type: property === undefined ? '' : loaded.checker.typeToString(property) };
      });
      assert(
        properties.some(property => property.name === 'name' && /\bstring\b/.test(property.type)),
        `Quick info must retain the declared text field: ${JSON.stringify(properties)}`,
      );
      return { display: loaded.checker.typeToString(type), properties };
    });
    measure('edit-and-diagnostics', () => {
      edit(original.replace("{ name: 'fixture' }", '{ name: 123 }'));
      return diagnostics([2322]);
    });
    measure('undo-and-diagnostics', () => {
      edit(original);
      return diagnostics([]);
    });
  } finally {
    try {
      api?.close();
    } finally {
      writeFileSync(file, original);
    }
  }
  return results;
}

function compilation(project, config, schema) {
  const original = read(schema);
  const changed = original.replace('MinLength<1>', 'MinLength<2>');
  assert.notEqual(changed, original, 'The affected edit must change the existing consumer schema');
  const cache = join(project, 'benchmark.tsbuildinfo');
  const args = [
    '-p',
    config,
    '--incremental',
    '--tsBuildInfoFile',
    cache,
    '--extendedDiagnostics',
    '--pretty',
    'false',
  ];
  const samples = [];
  try {
    for (const mode of ['clean', 'incremental', 'affected-edit']) {
      const before = existsSync(cache) ? read(cache) : undefined;
      assert.equal(before === undefined, mode === 'clean');
      if (mode === 'affected-edit') writeFileSync(schema, changed);
      const start = performance.now();
      const stdout = execFileSync(COMPILER, args, {
        cwd: project,
        encoding: 'utf8',
        timeout: 180_000,
        killSignal: 'SIGKILL',
        maxBuffer: 64 * 1024 * 1024,
      });
      const elapsedMs = performance.now() - start;
      const after = read(cache);
      if (mode === 'incremental') assert.equal(after, before, 'An unchanged compilation must reuse its cache');
      if (mode === 'affected-edit') assert.notEqual(after, before, 'The edited schema must update compiler state');
      samples.push({ mode, elapsedMs, command: [COMPILER, ...args], stdout });
    }
  } finally {
    writeFileSync(schema, original);
  }
  return samples;
}

function run(selected) {
  const parent = join(ROOT, '.cache');
  mkdirSync(parent, { recursive: true });
  const scratch = mkdtempSync(join(parent, 'typescript-'));
  const results = [];
  try {
    for (const [name, members] of [
      ['consumer-product', ['src', 'contracts.ts', 'zmdb.config.ts', 'tsconfig.consumer.json', 'package.json']],
      ['consumer-server-core', ['src', 'tsconfig.documented.json', 'package.json']],
    ]) {
      for (const member of members) {
        const destination = join(scratch, 'fixtures', name, member);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(join(ROOT, 'fixtures', name, member), destination, { recursive: true });
      }
    }
    symlinkSync(join(ROOT, 'node_modules'), join(scratch, 'node_modules'), 'dir');
    cpSync(
      join(scratch, 'fixtures/consumer-product/src/schema.ts'),
      join(scratch, 'fixtures/consumer-server-core/src/schema.ts'),
    );
    for (const name of selected) {
      const [fixture, filename] = configurations[name];
      const project = join(scratch, 'fixtures', fixture);
      const config = join(project, filename);
      const file = join(project, 'src/editor-benchmark.ts');
      const schema = join(project, 'src/schema.ts');
      const schemaImport = relative(dirname(file), schema).replaceAll('\\', '/').replace(/\.ts$/, '.js');
      writeFileSync(
        file,
        [
          "import type { CreateDTO } from 'zmdb';",
          `import type { Order } from '${schemaImport.startsWith('.') ? schemaImport : `./${schemaImport}`}';`,
          "export const draft: CreateDTO<Order> = { name: 'fixture' };",
          'export const copied = draft.name;',
          '',
        ].join('\n'),
      );
      const options = JSON.parse(read(config));
      options.include.push('src/editor-benchmark.ts');
      writeFileSync(config, JSON.stringify(options));
      results.push({
        fixture,
        configuration: filename,
        editor: editor(project, config, file),
        compilation: compilation(project, config, schema),
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return {
    command: [process.execPath, ...process.argv.slice(1)],
    node: process.version,
    typescript: JSON.parse(readFileSync(TYPESCRIPT, 'utf8')).version,
    compiler: COMPILER,
    resolution:
      'Existing workspace dependencies; copied consumer fixtures and isolated compiler caches. OS caches are uncontrolled.',
    results,
  };
}

const { values } = parseArgs({
  options: { fixture: { type: 'string', default: 'both' }, output: { type: 'string' }, help: { type: 'boolean' } },
});
if (values.help)
  console.log('node benchmarks/scripts/typescript.mjs [--fixture product|server|both] [--output result.json]');
else {
  assert(['product', 'server', 'both'].includes(values.fixture), 'Unknown fixture; choose product, server or both');
  const result = run(values.fixture === 'both' ? ['product', 'server'] : [values.fixture]);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (values.output !== undefined) {
    const destination = resolve(values.output);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, output);
  }
  process.stdout.write(output);
}
