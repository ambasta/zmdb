// Tests (#304) for OpenAPI generation — RED first (openapi exports absent).
// Deterministic 3.1 doc: paths, {param} conversion, parameters, method keys.
// Per packages/web/src/openapi/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Controller, Get, Post } from '../routing/index.js';
import { serveOpenApi, toOpenApi } from './index.js';

@Controller('/users')
class UsersController {
  @Get('/:id')
  get() {}
  @Post()
  create() {}
}

describe('@zmdb/web openapi: toOpenApi', () => {
  it('emits a 3.1 doc with paths and converted path params', () => {
    const doc = toOpenApi([UsersController], { info: { title: 'Test', version: '1.0.0' } });
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info).toEqual({ title: 'Test', version: '1.0.0' });
    expect(Object.keys(doc.paths)).toContain('/users/{id}');
    expect(Object.keys(doc.paths)).toContain('/users');
  });

  it('serves the document from a handler, as the same object every request', () => {
    // The handler is what gets mounted at /openapi.json, so the thing worth pinning is that
    // it does not rebuild the document per request — a doc regenerated on every hit is a doc
    // that can start disagreeing with itself under a controller registered later, and it
    // makes the cheapest endpoint in the app the most expensive one.
    const doc = toOpenApi([UsersController], { info: { title: 'Test', version: '1.0.0' } });
    const handler = serveOpenApi(doc);
    expect(handler()).toBe(doc);
    expect(handler()).toBe(handler());
    expect(JSON.parse(JSON.stringify(handler()))).toEqual(doc);
  });

  it('adds a path-parameter entry for :id', () => {
    const doc = toOpenApi([UsersController]);
    const op = doc.paths['/users/{id}']?.get;
    expect(op?.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }]);
  });

  it('uses lowercased method keys as operations', () => {
    const doc = toOpenApi([UsersController]);
    expect(Object.keys(doc.paths['/users'] ?? {})).toContain('post');
  });

  it('attaches provided body/response schemas', () => {
    const doc = toOpenApi([UsersController], {
      schemas: { '/users': { body: { type: 'object' }, response: { type: 'object' } } },
    });
    const post = doc.paths['/users']?.post;
    expect(post?.requestBody).toBeDefined();
    expect(post?.responses['200']).toBeDefined();
  });

  it('is deterministic (stable path ordering)', () => {
    const a = JSON.stringify(toOpenApi([UsersController]));
    const b = JSON.stringify(toOpenApi([UsersController]));
    expect(a).toBe(b);
  });
});
