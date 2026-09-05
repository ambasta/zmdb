import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NAV, PAGE_META } from './pages.mjs';

const ROOT = process.cwd();
const PAGE = join(ROOT, 'docs-site', 'content', 'generated-client.md');

interface DocumentedExample {
  readonly file: string;
  readonly source: string;
}

function documentedExamples(source: string): readonly DocumentedExample[] {
  const lines = source.split('\n');
  const examples: DocumentedExample[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (!/^```(?:ts|typescript)$/u.test(lines[index] ?? '')) continue;
    const code: string[] = [];
    index++;
    while (index < lines.length && lines[index] !== '```') {
      code.push(lines[index] ?? '');
      index++;
    }
    const marker = /^\/\/ docs-file: ([A-Za-z0-9._/-]+)$/u.exec(code[0] ?? '');
    if (marker === null) throw new Error(`generated-client.md TypeScript fence has no docs-file marker`);
    const file = marker[1] ?? '';
    if (
      file.startsWith('/') ||
      file.split('/').some(segment => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error(`generated-client.md has unsafe docs-file marker ${file}`);
    }
    examples.push({ file, source: code.join('\n').trimEnd() });
  }
  return examples;
}

function openApiOperationIds(source: string): readonly string[] {
  return [...source.matchAll(/"operationId":\s*"([^"]+)"/gu)].map(match => match[1] ?? '').toSorted();
}

function generatedOperationIds(source: string): readonly string[] {
  return [...source.matchAll(/^\/\/ operation ([A-Za-z_$][A-Za-z0-9_$]*)$/gmu)].map(match => match[1] ?? '').toSorted();
}

function markdownFiles(): readonly string[] {
  const packageReadmes = readdirSync(join(ROOT, 'packages'), { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? [join(ROOT, 'packages', entry.name, 'README.md')] : [],
  );
  const content = readdirSync(join(ROOT, 'docs-site', 'content'), { withFileTypes: true }).flatMap(entry =>
    entry.isFile() && entry.name.endsWith('.md') ? [join(ROOT, 'docs-site', 'content', entry.name)] : [],
  );
  return [join(ROOT, 'README.md'), join(ROOT, 'ARCHITECTURE.md'), ...packageReadmes, ...content];
}

describe('generated-client documentation journey', () => {
  it('marks every TypeScript example for packed-fixture compilation', () => {
    const examples = documentedExamples(readFileSync(PAGE, 'utf8'));
    const files = examples.map(example => example.file);

    expect(files).toEqual([
      'src/metadata.ts',
      'src/account.contract.ts',
      'src/runtime.ts',
      'zmdb.config.ts',
      'src/generated-client.ts',
      'src/responses.ts',
      'src/browser.ts',
      'src/node.ts',
      'src/manual-client.ts',
    ]);
    expect(new Set(files).size).toBe(files.length);
    expect(examples.every(example => example.source.length > 0)).toBe(true);
  });

  it('the documented operation ids match generated fixture output', () => {
    const page = readFileSync(PAGE, 'utf8');
    const marker = /<!-- generated-client-operation-ids: ([^>]+) -->/u.exec(page);
    expect(marker).not.toBeNull();
    const documented = (marker?.[1] ?? '').trim().split(/\s+/u).toSorted();
    const openApi = openApiOperationIds(
      readFileSync(join(ROOT, 'fixtures', 'consumer-http-client', 'generated', 'openapi.json'), 'utf8'),
    );
    const generated = generatedOperationIds(
      readFileSync(join(ROOT, 'fixtures', 'consumer-http-client', 'generated', 'http-client.generated.ts'), 'utf8'),
    );

    expect(documented).toEqual(openApi);
    expect(documented).toEqual(generated);
    for (const operationId of documented) expect(page).toContain(operationId);
  });

  it('the docs never instruct users to generate an HTTP client or SDK from OpenAPI', () => {
    const forbidden = [
      /\bgenerate one from \[?OpenAPI\b/giu,
      /\bgenerate (?:a |the )?(?:typed )?(?:client|SDK)(?: code)? from (?:an? )?\[?OpenAPI\b/giu,
      /\buse (?:an? )?\[?OpenAPI[^\n.]* to generate (?:a |the )?(?:client|SDK)\b/giu,
    ];
    const violations: string[] = [];

    for (const file of markdownFiles()) {
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const [index, line] of source.split('\n').entries()) {
        if (forbidden.some(pattern => pattern.test(line))) {
          violations.push(`${file.slice(ROOT.length + 1)}:${String(index + 1)} ${line.trim()}`);
        }
        for (const pattern of forbidden) pattern.lastIndex = 0;
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps generated and manual client paths explicit in the Client applications journey', () => {
    const page = readFileSync(PAGE, 'utf8');
    const group = NAV.find(candidate => candidate.title === 'Client applications');

    expect(group?.pages).toContain('generated-client');
    expect(PAGE_META['generated-client']).toEqual({ title: 'Generated HTTP Client', status: 'supported' });
    for (const phrase of [
      'Authentication',
      'Responses, errors, and cancellation',
      'Versions',
      'Browser',
      'Node',
      'Manual `@zmdb/client` usage is a different path',
      'OpenAPI is an output beside the generated client',
      '--check',
      '--watch',
    ]) {
      expect(page, phrase).toContain(phrase);
    }
  });
});
