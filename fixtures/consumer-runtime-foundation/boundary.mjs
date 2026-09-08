import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire, registerHooks } from 'node:module';
import { join } from 'node:path';

const specifiers = JSON.parse(process.argv[2]);
const roots = ['@zmdb/schema', '@zmdb/sql', '@zmdb/validator', '@zmdb/orm'];
const require = createRequire(import.meta.url);
const edges = [];
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ?? '';
    if (roots.some(name => parent.includes(`/node_modules/${name}/`))) {
      edges.push({ parent, specifier });
      assert(!specifier.startsWith('node:'), `foundation reached built-in ${specifier}`);
      assert(
        specifier.startsWith('.') || roots.some(name => specifier === name || specifier.startsWith(`${name}/`)),
        `foundation reached external owner ${specifier}`,
      );
    }
    const result = next(specifier, context);
    if (roots.some(name => specifier === name || specifier.startsWith(`${name}/`))) {
      assert.match(result.url, /\/node_modules\/@zmdb\/(?:schema|sql|validator|orm)\/dist\//);
    }
    return result;
  },
});
try {
  for (const specifier of specifiers) await import(specifier);
} finally {
  hooks.deregister();
}
for (const name of ['@zmdb/schema-core', '@zmdb/query-compiler', '@zmdb/aot-validator', '@zmdb/repository']) {
  assert.throws(() => require.resolve(name), { code: 'MODULE_NOT_FOUND' });
}
for (const name of ['@zmdb/validator/utilities', '@zmdb/sql/naming', '@zmdb/sql/outbox', '@zmdb/orm/query']) {
  assert.throws(
    () => require.resolve(name),
    error => ['ERR_PACKAGE_PATH_NOT_EXPORTED', 'MODULE_NOT_FOUND'].includes(error.code),
  );
}
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else if (/\.(?:[cm]?js|d\.[cm]?ts)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      assert.doesNotMatch(
        source,
        /(?:from\s*|import\s*\(\s*|import\s*)['"][^'"]*\.(?:ts|tsx)['"]/,
        `stale source extension in ${path}`,
      );
      assert.doesNotMatch(
        source,
        /@zmdb\/(?:schema-core|query-compiler|aot-validator|repository)(?:[/'"])/,
        `old package entry in ${path}`,
      );
    }
  }
}
for (const name of new Set(specifiers.map(specifier => specifier.split('/').slice(0, 2).join('/')))) {
  await inspect(join('node_modules', name, 'dist'));
}
console.log(JSON.stringify({ exports: specifiers, edges }));
