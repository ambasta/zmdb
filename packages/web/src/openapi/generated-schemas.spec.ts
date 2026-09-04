// `toOpenApi` fed from generated literals (`PLAN-type-first.md` Phase 6).
//
// The other openapi specs hand `toOpenApi` documents written by hand. This one runs the
// zmdb build plugin over `__fixtures__/route-schemas.ts`, where the documents are asked
// for by type — `toJsonSchema<CreateDTO<User>>()` — and then feeds what the plugin
// produced into `toOpenApi`. So the assertions cover the join between the two packages:
// the emitted literal is a `RouteSchemas` without a cast, and it says what the type said.

import { readFileSync } from 'node:fs';

import { zmdbAot } from '@zmdb/aot-validator/plugin';
import { beforeAll, describe, expect, it } from 'vitest';

import { Controller, Get, Post } from '../routing/index.js';
import { toOpenApi, type RouteSchemas } from './index.js';

const FIXTURES = new URL('./__fixtures__/', import.meta.url).pathname;
const FILE = `${FIXTURES}route-schemas.ts`;

@Controller('/users')
class UsersController {
  @Get('/:id')
  get() {}
  @Post()
  create() {}
}

let schemas: Record<string, RouteSchemas> = {};
let emitted = '';

beforeAll(() => {
  // The real plugin, with its real default `onDiagnostic` — which throws. A refused call
  // site here would mean `toJsonSchema<T>()` silently survived into the bundle, where it
  // throws on first use, and that must fail the test rather than be worked around.
  const plugin = zmdbAot({ project: `${FIXTURES}tsconfig.json`, cwd: FIXTURES });
  const source = readFileSync(FILE, 'utf8');
  const result = plugin.transform(source, FILE);
  plugin.buildEnd?.();
  if (!result) throw new Error('the plugin declined to transform the fixture');
  emitted = result.code;

  // `new Function` has no module scope and does not parse TypeScript, so the imports and
  // the `declare` come out. Every other line is a call, and all of them were rewritten.
  const body = emitted.replace(/^import\b[^;]*;\s*$/gm, '').replace(/^declare\b.*$/gm, '');
  const run = new Function('routes', body) as (fn: (s: Record<string, RouteSchemas>) => void) => void;
  run(collected => {
    schemas = collected;
  });
});

/** The emitted module's code lines, comments dropped. */
function code(): string[] {
  return emitted
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'));
}

describe('toOpenApi fed from a generated document', () => {
  it('takes the emitted literal as RouteSchemas with no cast at the boundary', () => {
    // The cast-free part is the compiler's job and it happens at the fixture's `routes(…)`
    // call; what is left to assert at runtime is that the plugin produced the documents at
    // all rather than leaving the calls alone.
    expect(Object.keys(schemas)).toEqual(['/users']);
    expect(schemas['/users']?.body).toBeDefined();
    // Both properties are now references to hoisted literals. The only `toJsonSchema` left
    // outside the fixture's comments is an import nothing uses.
    expect(code().filter(line => line.includes('toJsonSchema'))).toEqual([
      "import { toJsonSchema } from '@zmdb/schema-core/openapi';",
    ]);
  });

  it('describes the create body the type describes', () => {
    expect(schemas['/users']?.body).toEqual({
      type: 'object',
      properties: {
        createdAt: { type: 'string', format: 'date-time' },
        email: { type: 'string', maxLength: 255 },
      },
      // `id` is absent entirely (the database generates it) and `createdAt` is present but
      // not required (it has a default). That distinction is why `Serial` and `HasDefault`
      // are two tags.
      required: ['email'],
    });
  });

  it('never publishes a sensitive column, in the body or the response', () => {
    for (const document of [schemas['/users']?.body, schemas['/users']?.response]) {
      expect(Object.keys((document as { properties: object }).properties)).not.toContain('passwordHash');
    }
    expect(emitted).not.toContain('passwordHash');
  });

  it('embeds the documents in the OpenAPI document', () => {
    const doc = toOpenApi([UsersController], { info: { title: 'Users', version: '1.0.0' }, schemas });
    const post = doc.paths['/users']?.post;
    expect(post?.requestBody?.content['application/json']?.schema).toBe(schemas['/users']?.body);
    expect(post?.responses['200']?.content?.['application/json']?.schema).toBe(schemas['/users']?.response);
  });

  it('hands out a frozen document, because every route shares one copy of it', () => {
    expect(Object.isFrozen(schemas['/users']?.body)).toBe(true);
  });
});
