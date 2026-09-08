import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, posix, resolve } from 'node:path';

import { parseSync } from '@babel/core';
import { buildSync } from 'esbuild';

import { parseFences } from './fences.mjs';
import { LEGACY_REDIRECTS } from './navigation-plan.mjs';
import { NAV } from './pages.mjs';

const root = resolve(import.meta.dirname, '..');
const modes = new Set(['compile', 'expect-error', 'illustrative']);
const environments = new Set(['node', 'browser', 'react-native']);
const identity = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const failures = [];
const samples = [];
let fenceCount = 0;
const groups = new Map();
const pages = new Set();

function fail(label, message) {
  failures.push(`${label}: ${message}`);
}

function validPath(value) {
  return (
    typeof value === 'string' &&
    !isAbsolute(value) &&
    !value.includes('\\') &&
    !value.split('/').some(part => part === '' || part === '.' || part === '..')
  );
}

function metadata(fence, slug) {
  let meta;
  try {
    meta = JSON.parse(fence.metadata ?? '');
  } catch {
    fail(`${slug}:${fence.line}`, 'sample metadata must be one JSON object');
    return undefined;
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    fail(`${slug}:${fence.line}`, 'sample metadata must be one JSON object');
    return undefined;
  }
  const label = `${slug}:${String(meta.id ?? fence.line)}`;
  const errors = [];
  if (!modes.has(meta.mode)) errors.push('mode is invalid');
  if (typeof meta.id !== 'string' || !identity.test(meta.id)) errors.push('id is invalid');
  if (meta.group !== undefined && (typeof meta.group !== 'string' || !identity.test(meta.group)))
    errors.push('group is invalid');
  if (meta.file !== undefined && !validPath(meta.file))
    errors.push('file must be a relative POSIX path without traversal');
  if (meta.group !== undefined && meta.file === undefined) errors.push('group requires file');
  if (meta.environment !== undefined && !environments.has(meta.environment)) errors.push('environment is invalid');
  if (meta.mode === 'compile') {
    if (meta.reason !== undefined || meta.diagnostics !== undefined)
      errors.push('compile forbids reason and diagnostics');
    if (meta.run !== undefined && meta.run !== true) errors.push('run must be true when present');
    if (meta.run === true && meta.environment === undefined) errors.push('run requires environment');
  }
  if (meta.mode === 'expect-error') {
    if (
      !Array.isArray(meta.diagnostics) ||
      meta.diagnostics.length === 0 ||
      meta.diagnostics.some(value => typeof value !== 'string' || value.trim() === '')
    )
      errors.push('expect-error requires diagnostics');
    if (meta.reason !== undefined || meta.run !== undefined) errors.push('expect-error forbids reason and run');
  }
  if (meta.mode === 'illustrative') {
    if (
      typeof meta.reason !== 'string' ||
      meta.reason.trim().length < 12 ||
      /^example(?: only)?[.!]?$/i.test(meta.reason.trim())
    ) {
      errors.push('illustrative requires a meaningful reason identifying missing context');
    }
    if (meta.diagnostics !== undefined || meta.run !== undefined)
      errors.push('illustrative forbids diagnostics and run');
  }
  if (errors.length) {
    fail(label, errors.join('; '));
    return undefined;
  }
  return { ...meta, ...fence, label, slug, file: meta.file ?? (fence.language === 'tsx' ? 'index.tsx' : 'index.ts') };
}

for (const slug of NAV.flatMap(group => group.pages)) {
  if (Object.hasOwn(LEGACY_REDIRECTS, slug)) continue;
  const seen = new Set();
  for (const fence of parseFences(readFileSync(join(root, 'docs-site/content', `${slug}.md`), 'utf8'))) {
    if (!['ts', 'typescript', 'tsx'].includes(fence.language)) continue;
    pages.add(slug);
    fenceCount++;
    const sample = metadata(fence, slug);
    if (!sample) continue;
    if (seen.has(sample.id)) fail(sample.label, 'duplicate sample id');
    seen.add(sample.id);
    samples.push(sample);
    if (sample.mode === 'illustrative') continue;
    const key = `${slug}:${sample.group ?? sample.id}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }
}

function imports(code, file) {
  const ast = parseSync(code, {
    babelrc: false,
    configFile: false,
    filename: file,
    parserOpts: { sourceType: 'module', plugins: ['typescript', 'jsx', 'decorators'] },
  });
  const found = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (
      ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) &&
      node.source
    ) {
      found.push(node.source.value);
    }
    if (node.type === 'TSImportType') found.push(node.argument?.value ?? node.source?.value);
    if (node.type === 'TSExternalModuleReference') found.push(node.expression?.value);
    if (node.type === 'CallExpression' && (node.callee?.type === 'Import' || node.callee?.name === 'require')) {
      found.push(node.arguments[0]?.value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(ast);
  return found;
}

function checkImports(group) {
  const files = new Set(group.map(sample => sample.file));
  for (const sample of group) {
    for (const specifier of imports(sample.code, sample.file)) {
      if (typeof specifier !== 'string')
        throw new Error(`${sample.label}: imports require a literal public entry or group file`);
      if (
        isAbsolute(specifier) ||
        /(?:^|\/)packages\/[^/]+\/src(?:\/|$)/.test(specifier) ||
        specifier.startsWith('file:')
      ) {
        throw new Error(`${sample.label}: private source import ${specifier}`);
      }
      if (!specifier.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(sample.file), specifier));
      const targets = [target, target.replace(/\.js$/, '.ts'), target.replace(/\.js$/, '.tsx')];
      if (!sample.group || !targets.some(path => files.has(path))) {
        throw new Error(`${sample.label}: relative import ${specifier} leaves its group`);
      }
    }
  }
}

function executeSample(directory, sample) {
  if (sample.environment !== 'node')
    throw new Error(`${sample.label}: runtime environment requires an issue-owned fixture`);
  const output = join(directory, 'sample-runtime.mjs');
  buildSync({
    entryPoints: [join(directory, sample.file)],
    outfile: output,
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    logLevel: 'silent',
  });
  const result = spawnSync(
    process.execPath,
    [
      '--import=data:text/javascript,import net from "node:net"; import http from "node:http"; import https from "node:https"; globalThis.fetch=()=>{throw new Error("network access blocked: fetch")}; net.connect=net.createConnection=()=>{throw new Error("network access blocked: net")}; http.request=http.get=()=>{throw new Error("network access blocked: http")}; https.request=https.get=()=>{throw new Error("network access blocked: https")};',
      '--permission',
      `--allow-fs-read=${directory}`,
      `--allow-fs-read=${realpathSync(join(root, 'node_modules'))}`,
      `--allow-fs-read=${realpathSync(join(root, 'packages'))}`,
      output,
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 1024 * 1024,
      env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' },
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error(
      `${sample.label}: runtime time/output limit or external state requires an issue-owned fixture: ${result.error?.message ?? ''}\n${result.stdout ?? ''}${result.stderr ?? ''}`,
    );
  }
}

let compiled = 0;
let compiledFiles = 0;
for (const [key, group] of groups) {
  let directory;
  try {
    const first = group[0];
    if (new Set(group.map(sample => sample.file)).size !== group.length) throw new Error('duplicate group file');
    if (group.some(sample => sample.mode !== first.mode)) throw new Error('inconsistent group mode');
    if (group.some(sample => sample.environment !== first.environment))
      throw new Error('inconsistent group environment');
    checkImports(group);
    directory = mkdtempSync(join(dirname(root), 'zmdb-doc-sample-'));
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    writeFileSync(join(directory, 'package.json'), '{"type":"module","private":true}\n');
    for (const sample of group) {
      mkdirSync(dirname(join(directory, sample.file)), { recursive: true });
      writeFileSync(join(directory, sample.file), sample.code + '\n');
    }
    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            allowImportingTsExtensions: false,
            strict: true,
            noUncheckedIndexedAccess: true,
            exactOptionalPropertyTypes: true,
            noImplicitOverride: true,
            isolatedModules: true,
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            target: 'ESNext',
            lib: ['node', 'react-native'].includes(first.environment) ? ['ESNext'] : ['ESNext', 'DOM'],
            types:
              first.environment === 'browser' ? [] : [first.environment === 'react-native' ? 'react-native' : 'node'],
            noEmit: true,
            skipLibCheck: true,
            verbatimModuleSyntax: true,
            moduleDetection: 'force',
            jsx: 'react-jsx',
          },
          files: group.map(sample => sample.file),
        },
        null,
        2,
      ),
    );
    const result = spawnSync(
      join(root, 'node_modules/.bin/tsc'),
      ['--noEmit', '--pretty', 'false', '-p', join(directory, 'tsconfig.json')],
      {
        cwd: directory,
        encoding: 'utf8',
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (result.error) throw new Error(`compiler time/output limit: ${result.error.message}`);
    const diagnostics = output.split('\n').filter(line => /error TS\d+:/.test(line));
    if (first.mode === 'compile') {
      if (result.status !== 0) throw new Error(output || 'compiler failed without a diagnostic');
      for (const sample of group) if (sample.run === true) executeSample(directory, sample);
    } else {
      const expected = group.flatMap(sample => sample.diagnostics);
      if (result.status === 0 || diagnostics.length === 0)
        throw new Error('expect-error sample unexpectedly compiles or has no TypeScript diagnostic');
      const unmatched = diagnostics.filter(line => !expected.some(value => line.includes(value)));
      const missing = expected.filter(value => !diagnostics.some(line => line.includes(value)));
      if (unmatched.length || missing.length)
        throw new Error(`unexpected diagnostics: ${unmatched.join('\n')}; missing: ${missing.join(', ')}`);
      console.log(`${key}: ${diagnostics.join('\n')}`);
    }
    compiled++;
    compiledFiles += group.length;
    console.log(`${key}: ${first.mode}, ${group.length} files, environment ${first.environment ?? 'typecheck-only'}`);
  } catch (error) {
    fail(key, error.message);
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
}
for (const sample of samples.filter(entry => entry.mode === 'illustrative'))
  console.log(`${sample.label}: illustrative — ${sample.reason}`);
console.log(
  `${fenceCount} fences in ${pages.size} pages; ${compiled} compiled groups; ${compiledFiles} compiled files`,
);
for (const mode of modes) console.log(`${mode}: ${samples.filter(sample => sample.mode === mode).length}`);
for (const environment of environments)
  console.log(`${environment}: ${samples.filter(sample => sample.environment === environment).length}`);
for (const failure of failures) console.error(failure);
process.exitCode = failures.length ? 1 : 0;
