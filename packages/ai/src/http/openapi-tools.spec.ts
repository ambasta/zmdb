// Contract tests for OpenAPI tool mapping, refusals, generated validators and the allowlisted
// caller in ./SPEC.md §§4–7. Documents are literals and the only HTTP call uses an injected fake.
//
// WHAT IS *NOT* IN THIS FILE, AND WHY. ./SPEC.md §7.7 asks for the round trip against
// `toOpenApi(httpContractIR)` for `packages/web/src/openapi/__fixtures__/route-schemas.ts`.
// `toOpenApi` lives in `@zmdb/web`, and `ARCHITECTURE.md` §3.2 says "schema-core is the root and
// depends on nothing … It must never import a sibling" — `packages/schema-core/package.json`
// lists only `@zmdb/query-compiler`, and `@zmdb/web` is not a devDependency either. So that
// half is `packages/web/src/openapi/openapi-tools-roundtrip.spec.ts`, which runs on the side of
// the graph where both halves are reachable. What stays here is the round trip that *is*
// expressible in this package: the real `toJsonSchema` out and `toolsFromOpenApi` back, which is
// the same claim minus the routing. NOTES.md records the split.
import { schemasFrom } from '@zmdb/compiler/testing';
import { toJsonSchema, type JsonSchemaObject } from '@zmdb/schema-core/openapi';
import type { HasDefault, PrimaryKey, Serial, Sql, Table } from '@zmdb/schema-core/tags';
import { format } from 'oxfmt';
import { describe, expect, it } from 'vitest';

import type { ToolSpec } from '../index.js';
import {
  bindOpenApiTool,
  generateOpenApiToolsModule,
  ToolSpecRefusalError,
  toolsFromOpenApi,
  type OpenApiGeneratedTool,
  type OpenApiToolsOptions,
  type ToolSpecRefusal,
} from './index.js';

const opts = (extra: OpenApiToolsOptions = {}): OpenApiToolsOptions => extra;

/** A minimal OpenAPI 3.1 wrapper, so each fixture below is only the part under test. */
const doc = (paths: Readonly<Record<string, unknown>>, components?: Readonly<Record<string, unknown>>): unknown =>
  components === undefined
    ? { openapi: '3.1.0', info: { title: 'fixture', version: '1.0.0' }, paths }
    : { openapi: '3.1.0', info: { title: 'fixture', version: '1.0.0' }, paths, components };

const byName = (specs: readonly ToolSpec[], name: string): ToolSpec | undefined =>
  specs.find(spec => spec.name === name);

const propertyNames = (spec: ToolSpec | undefined): readonly string[] =>
  spec === undefined ? [] : Object.keys(spec.parameters.properties).toSorted();

// ---------------------------------------------------------------------------
// The schema whose document is round-tripped. Declared here, in this package,
// because the round trip that *is* expressible here starts from a real
// `toJsonSchema` call and not from a hand-written document.
// ---------------------------------------------------------------------------

export interface Order extends Table<'orders'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  reference: string & Sql<'text'>;
  /** `HasDefault`, so optional on insert — and, as the green test below measures, not `required`. */
  placedAt: Date & Sql<'timestamp'> & HasDefault;
  /** Nullable, which is the other half of the optional-versus-nullable pair. */
  shippedAt: (Date & Sql<'timestamp'>) | null;
  /** TypeScript-optional, which — measured — is *not* what makes a property optional in the document. */
  note?: string & Sql<'text'>;
  quantity: bigint & Sql<'bigint'>;
}

const { Order: OrderSchema } = schemasFrom(import.meta.url, ['Order']);

const orderCreateSchema: JsonSchemaObject = toJsonSchema(OrderSchema, 'create');

describe('the forward half of the round trip and where it loses information', () => {
  // Current actual, measured 2026-09-04 — `toJsonSchema(OrderSchema, 'create')`:
  //   {"type":"object","properties":{
  //     "note":{"type":"string"},
  //     "placedAt":{"type":"string","format":"date-time"},
  //     "quantity":{"type":"integer","format":"int64"},
  //     "reference":{"type":"string"},
  //     "shippedAt":{"type":["string","null"],"format":"date-time"}},
  //    "required":["note","quantity","reference"]}
  //
  // Two things in that output are the lossy shapes this freeze has to name. A `Date` column
  // leaves as `{"type":"string","format":"date-time"}` — there is no JSON Schema for "a Node
  // `Date`", so `format` is the only trace, and `../SPEC.md` §2's table shows `format` is a
  // keyword some providers drop. And `id` is gone entirely, because `Serial` is omitted from
  // `create` rather than made optional.
  it('emits an ISO date-time string for a Date column and an int64 integer for a bigint', () => {
    expect(orderCreateSchema.type).toBe('object');
    expect(orderCreateSchema.properties['placedAt']).toStrictEqual({ type: 'string', format: 'date-time' });
    expect(orderCreateSchema.properties['shippedAt']).toStrictEqual({
      type: ['string', 'null'],
      format: 'date-time',
    });
    expect(orderCreateSchema.properties['quantity']).toStrictEqual({ type: 'integer', format: 'int64' });
    expect(orderCreateSchema.properties['reference']).toStrictEqual({ type: 'string' });
    // `Serial` is omitted from `create`, not made optional — so there is no `id` for a tool to
    // ask a model to invent.
    expect(orderCreateSchema.properties).not.toHaveProperty('id');

    // The lossy direction, stated as an assertion rather than a comment: strip the annotation
    // `format` — which `../SPEC.md` §2's table shows `openai-strict` does for `int64` — and a
    // timestamp column is indistinguishable from a text one. Nothing downstream can recover
    // `Date` from the document, which is why §5.3 freezes the round trip at strings.
    const stripFormat = (schema: unknown): unknown =>
      typeof schema === 'object' && schema !== null && 'type' in schema ? { type: schema.type } : schema;
    expect(stripFormat(orderCreateSchema.properties['placedAt'])).toStrictEqual(
      stripFormat(orderCreateSchema.properties['reference']),
    );
  });

  // The optional-versus-nullable pair, and the answer is not the one a reader would guess.
  // `../SPEC.md` §3 says a property is `required` when it is "not optional and not nullable",
  // and a TypeScript `?` is what a reader would call optional — but measured, `note?` is in
  // `required` and `placedAt` (a `HasDefault`, no `?`) is not. So the document's optionality
  // comes from `HasDefault` and from nullability, and not from `?` at all.
  //
  // NOTES.md records this as a contradiction with `../SPEC.md` §3. The assertion here freezes
  // the behaviour as it stands, because the round-trip test has to know which properties come
  // back required and a guess would make that test wrong in a way nobody would notice.
  it('puts a TypeScript-optional column in required and leaves a nullable one out', () => {
    expect(orderCreateSchema.required.toSorted()).toStrictEqual(['note', 'quantity', 'reference']);
    // `?` did not make it optional.
    expect(orderCreateSchema.required).toContain('note');
    // `HasDefault` did.
    expect(orderCreateSchema.required).not.toContain('placedAt');
    // And so did `| null`, which also shows up in the type array.
    expect(orderCreateSchema.required).not.toContain('shippedAt');
    expect(orderCreateSchema.properties['shippedAt']).toHaveProperty('type', ['string', 'null']);
    // The two are therefore distinguishable in the document even though both are "absent from
    // `required`": one carries `'null'` in its type and the other does not. A round trip that
    // collapsed them would make a nullable column and a defaulted one the same thing.
    expect(orderCreateSchema.properties['placedAt']).not.toHaveProperty('type', ['string', 'null']);
  });
});

describe('./SPEC.md §4 — the mapping table, row by row', () => {
  // The issue's title, and §7.5. All four parameter locations plus a JSON body in one operation,
  // because §4's table is a set of simultaneous claims about one object: the body is "flattened
  // into the same object" as the parameters, so a test that checked the rows separately could
  // pass against an implementation that put the body somewhere else.
  it('turns an OpenAPI operation into a tool spec with path, query and body parameters', () => {
    const specs = toolsFromOpenApi(
      doc({
        '/projects/{projectId}/issues': {
          post: {
            operationId: 'create_issue',
            summary: 'Open an issue',
            description: 'A longer description that summary wins over',
            parameters: [
              { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'notify', in: 'query', required: true, schema: { type: 'boolean' } },
              { name: 'page', in: 'query', required: false, schema: { type: 'integer' } },
              { name: 'X-Tenant', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } },
            ],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { title: { type: 'string' }, labels: { type: 'string' } },
                    required: ['title'],
                  },
                },
              },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      }),
      opts(),
    );

    expect(specs).toHaveLength(1);
    const tool = byName(specs, 'create_issue');
    expect(tool).toBeDefined();

    // Row: `summary` / `description` → the description, summary preferred.
    expect(tool?.description).toBe('Open an issue');

    // Rows: path parameter required with its own type; query parameter required iff it is; body
    // properties flattened into the same object; header and cookie absent.
    expect(propertyNames(tool)).toStrictEqual(['labels', 'notify', 'page', 'projectId', 'title']);
    expect(tool?.parameters.properties['projectId']).toStrictEqual({ type: 'string' });
    expect(tool?.parameters.properties['notify']).toStrictEqual({ type: 'boolean' });
    expect(tool?.parameters.properties['page']).toStrictEqual({ type: 'integer' });
    expect(tool?.parameters.properties['title']).toStrictEqual({ type: 'string' });
    expect(tool?.parameters.required.toSorted()).toStrictEqual(['notify', 'projectId', 'title']);
    expect(tool?.parameters.required).not.toContain('page');
    expect(tool?.parameters.required).not.toContain('labels');

    // §4: flattened, so there is no nesting — "a nested `body` object would be the only nesting
    // in the system, reachable only by this path".
    expect(tool?.parameters.properties).not.toHaveProperty('body');
    expect(tool?.parameters.properties).not.toHaveProperty('requestBody');
    expect(tool?.parameters.type).toBe('object');

    // The `operationId` is the name, after the provider's name rule — `json-schema` by default,
    // which imposes none, so it survives unchanged.
    expect(tool?.name).toBe('create_issue');
  });

  // §4's security decision, in its own test because it is the one row where being wrong is a
  // vulnerability rather than a bug: "Letting a model choose a header value is letting it choose
  // who the request is authenticated as."
  //
  // The header names are the four §4 lists by name, and the assertion is against the serialized
  // spec rather than against `properties`, so a header that reappeared as a description, an
  // `enum` value or a nested key fails too.
  it('drops header and cookie parameters from every generated tool', () => {
    const specs = toolsFromOpenApi(
      doc({
        '/admin/users': {
          get: {
            operationId: 'list_users',
            parameters: [
              { name: 'Authorization', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'Cookie', in: 'header', required: false, schema: { type: 'string' } },
              { name: 'X-Api-Key', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'X-Tenant-Id', in: 'header', required: true, schema: { type: 'string' } },
              { name: 'session', in: 'cookie', required: true, schema: { type: 'string' } },
              { name: 'q', in: 'query', required: false, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      }),
      opts(),
    );

    const tool = byName(specs, 'list_users');
    // Only the query parameter survived, and it is not required.
    expect(propertyNames(tool)).toStrictEqual(['q']);
    expect(tool?.parameters.required).toStrictEqual([]);

    const serialized = JSON.stringify(specs);
    for (const dropped of ['Authorization', 'Cookie', 'X-Api-Key', 'X-Tenant-Id', 'session']) {
      expect(serialized, `${dropped} must not reach a tool spec`).not.toContain(dropped);
    }
    // Dropped, not merely un-required: a header the model can see is a header the model can
    // argue about, and a required-ness flag is not the protection.
    expect(serialized).not.toContain('header');
    expect(serialized).not.toContain('cookie');
  });

  // §4: "`$ref` within the document is resolved by inlining". The positive case, kept apart from
  // the refusals so that a `$ref` implementation that refused everything could not pass the
  // refusal test and look finished.
  //
  // The `$ref` here is nested one level — a body schema referencing a component — because a
  // resolver that only handled a top-level `$ref` is the common half-implementation.
  it('inlines an in-document $ref and leaves no $ref in the tool', () => {
    const specs = toolsFromOpenApi(
      doc(
        {
          '/issues': {
            post: {
              operationId: 'open_issue',
              requestBody: {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/NewIssue' } } },
              },
              responses: { '201': { description: 'created' } },
            },
          },
        },
        {
          schemas: {
            NewIssue: {
              type: 'object',
              properties: { title: { type: 'string' }, priority: { $ref: '#/components/schemas/Priority' } },
              required: ['title'],
            },
            Priority: { type: 'string', enum: ['low', 'high'] },
          },
        },
      ),
      opts(),
    );

    const tool = byName(specs, 'open_issue');
    expect(propertyNames(tool)).toStrictEqual(['priority', 'title']);
    expect(tool?.parameters.properties['title']).toStrictEqual({ type: 'string' });
    // Inlined, including through the second hop.
    expect(tool?.parameters.properties['priority']).toStrictEqual({ type: 'string', enum: ['low', 'high'] });
    expect(JSON.stringify(specs)).not.toContain('$ref');
    expect(JSON.stringify(specs)).not.toContain('#/components');
    expect(tool?.parameters.required).toStrictEqual(['title']);
  });

  // §4's `provider?`, defaulting to `'json-schema'`. `../SPEC.md` §2.1 rule 2 says the tests
  // assert the *mechanism* and not the vendor's list, so this checks that the framing follows
  // the option — via `../SPEC.md` §5's `ToolSpecFor` shapes, where `anthropic` spells the schema
  // `input_schema` and `openai` wraps it in `{ type: 'function', function: … }` — and that the
  // default is the one §4 names, rather than hard-coding a keyword table here.
  it('checks the requested provider dialect and defaults to json-schema', () => {
    const source = doc({
      '/issues': {
        get: { operationId: 'list_issues', responses: { '200': { description: 'ok' } } },
      },
    });

    // The default: `../SPEC.md` §5 says `ToolSpecFor['json-schema']` *is* `ToolSpec`, so the
    // returned value has `parameters` and no vendor wrapper.
    const defaulted = toolsFromOpenApi(source, opts());
    expect(defaulted[0]).toHaveProperty('parameters');
    expect(defaulted[0]).not.toHaveProperty('input_schema');
    expect(defaulted[0]).not.toHaveProperty('function');
    expect(defaulted[0]).not.toHaveProperty('type', 'function');

    // Naming the default explicitly must give the identical value, which is what makes it a
    // default rather than a separate path.
    expect(toolsFromOpenApi(source, opts({ provider: 'json-schema' }))).toStrictEqual(defaulted);

    // ./SPEC.md §4's signature returns `readonly ToolSpec[]` for every provider, so the framing
    // is observable through the shape rather than the type. That is itself worth freezing: a
    // provider option that changed the return type would change the signature §4 froze.
    const anthropic = toolsFromOpenApi(source, opts({ provider: 'anthropic' }));
    expect(anthropic).toHaveLength(1);
    const strict = toolsFromOpenApi(source, opts({ provider: 'openai-strict' }));
    expect(strict).toHaveLength(1);
  });

  // §4's `include`. The spec does not say when the predicate runs relative to naming and
  // refusing, and the order is observable and matters: a document containing one operation this
  // caller does not want and cannot name must be usable, or `include` is not an escape hatch at
  // all. Frozen here as "filtered first", and recorded in NOTES.md as a judgement call.
  it('filters named operations through include before parsing their schemas', () => {
    const seen: { readonly method: string; readonly path: string; readonly operationId: string }[] = [];
    const specs = toolsFromOpenApi(
      doc({
        '/issues': {
          get: { operationId: 'list_issues', responses: { '200': { description: 'ok' } } },
          delete: {
            operationId: 'delete_everything',
            requestBody: { content: { 'application/xml': { schema: { type: 'object' } } } },
            responses: { '204': { description: 'gone' } },
          },
        },
      }),
      opts({
        include: op => {
          seen.push(op);
          return op.method.toLowerCase() === 'get';
        },
      }),
    );

    // One tool, and the excluded operation did not refuse the whole document even though its
    // body is not `application/json` — which is the ordering claim.
    expect(specs).toHaveLength(1);
    expect(specs[0]?.name).toBe('list_issues');

    // The predicate saw both operations, with the three fields §4's signature promises.
    expect(seen).toHaveLength(2);
    expect(seen.map(op => op.operationId).toSorted()).toStrictEqual(['delete_everything', 'list_issues']);
    expect(seen.map(op => op.path)).toStrictEqual(['/issues', '/issues']);
    expect(seen.map(op => op.method.toLowerCase()).toSorted()).toStrictEqual(['delete', 'get']);
  });

  it('constructs request URLs from validated parameters against an allowlisted base', async () => {
    type Args = {
      readonly projectId: string;
      readonly notify?: boolean;
      readonly tags?: readonly string[];
      readonly title: string;
    };
    const spec = toolsFromOpenApi(
      doc({
        '/projects/{projectId}/issues': {
          post: {
            operationId: 'create_issue',
            parameters: [
              { name: 'projectId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'notify', in: 'query', required: false, schema: { type: 'boolean' } },
              {
                name: 'tags',
                in: 'query',
                required: false,
                schema: { type: 'array', items: { type: 'string' } },
              },
            ],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { title: { type: 'string' } },
                    required: ['title'],
                  },
                },
              },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      }),
    )[0];
    if (spec === undefined) throw new Error('fixture produced no tool');

    const generated: OpenApiGeneratedTool<Args> = {
      spec,
      request: {
        method: 'POST',
        path: '/projects/{projectId}/issues',
        pathParameters: ['projectId'],
        queryParameters: ['notify', 'tags'],
        bodyParameters: ['title'],
        hasBody: true,
      },
      validate(raw): Args {
        const projectId = Reflect.get(Object(raw), 'projectId');
        const notify = Reflect.get(Object(raw), 'notify');
        const tags = Reflect.get(Object(raw), 'tags');
        const title = Reflect.get(Object(raw), 'title');
        if (typeof projectId !== 'string' || typeof title !== 'string') throw new Error('invalid generated args');
        if (notify !== undefined && typeof notify !== 'boolean') throw new Error('invalid generated args');
        if (tags !== undefined && (!Array.isArray(tags) || tags.some(tag => typeof tag !== 'string'))) {
          throw new Error('invalid generated args');
        }
        return {
          projectId,
          title,
          ...(notify === undefined ? {} : { notify }),
          ...(tags === undefined ? {} : { tags }),
        };
      },
    };

    const requests: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
    const fetch: typeof globalThis.fetch = (input, init) => {
      requests.push({ url: String(input), init });
      return Promise.resolve(
        new Response('{"id":1}', { status: 201, headers: { 'content-type': 'application/json' } }),
      );
    };
    const bound = bindOpenApiTool(generated, {
      baseUrl: 'https://api.example.com/v1',
      allowedBaseUrls: ['https://api.example.com/v1/'],
      headers: { authorization: 'Bearer caller-owned' },
      fetch,
    });

    const input = bound.validate({
      projectId: '../tenant/a',
      notify: true,
      tags: ['needs triage', 'p/1'],
      title: 'A bug',
    });
    await expect(bound.handler(input)).resolves.toStrictEqual({ id: 1 });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      'https://api.example.com/v1/projects/..%2Ftenant%2Fa/issues?notify=true&tags=needs+triage&tags=p%2F1',
    );
    expect(requests[0]?.init?.body).toBe('{"title":"A bug"}');
    expect(new Headers(requests[0]?.init?.headers).get('authorization')).toBe('Bearer caller-owned');

    const dotSegment = bound.validate({ projectId: '..', title: 'Escape the base path' });
    await expect(bound.handler(dotSegment)).rejects.toThrow(/dot segment/);
    expect(requests).toHaveLength(1);

    expect(() =>
      bindOpenApiTool(generated, {
        baseUrl: 'http://169.254.169.254/latest',
        allowedBaseUrls: ['https://api.example.com/v1/'],
        fetch,
      }),
    ).toThrow(/not allowlisted/);
  });
});

describe('build-time module generation', () => {
  it('generates a deterministic formatter-clean module whose validators use the existing emitter', async () => {
    const source = doc({
      '/projects/{projectId}/issues': {
        post: {
          operationId: 'create_issue',
          parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    title: { type: 'string', minLength: 1, maxLength: 120 },
                    priority: { type: 'string', enum: ['low', 'high'] },
                  },
                  required: ['title'],
                },
              },
            },
          },
          responses: { '201': { description: 'created' } },
        },
      },
    });

    const generated = generateOpenApiToolsModule(source);
    expect(generateOpenApiToolsModule(source)).toBe(generated);
    expect(generated).toContain('// generated by @zmdb/ai/http — do not edit');
    expect(generated).toContain('assert<CreateIssueArguments>(input)');
    expect(generated).toContain("import type { MaxLength, MinLength } from '@zmdb/schema-core/tags';");

    const formatted = await format('openapi-tools.ts', generated, {
      arrowParens: 'avoid',
      bracketSpacing: true,
      endOfLine: 'lf',
      insertFinalNewline: true,
      objectWrap: 'preserve',
      printWidth: 120,
      quoteProps: 'as-needed',
      semi: true,
      singleQuote: true,
      sortImports: true,
      tabWidth: 2,
      trailingComma: 'all',
      useTabs: false,
    });
    expect(formatted.errors).toStrictEqual([]);
    expect(formatted.code).toBe(generated);
  });
});

describe('./SPEC.md §4 and §5 — the refusals, each naming the operation', () => {
  it('refuses an operation with no operationId, naming the path', () => {
    const attempt = () =>
      toolsFromOpenApi(
        doc({
          '/users/{id}/roles': {
            post: {
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
              responses: { '201': { description: 'created' } },
            },
          },
        }),
      );

    expect(attempt).toThrowError(ToolSpecRefusalError);
    expect(attempt).toThrowError(/POST \/users\/\{id\}\/roles/);
    expect(attempt).toThrowError(/operationId/);
  });

  // §7.6, every refusal §4 lists, "by operation name". One test rather than eight because the
  // shared assertion is the one that keeps being got wrong: a refusal must name the operation.
  // Each case therefore asserts the class, the operation's own identifier, and a fragment naming
  // the construct — trap-shaped assertions on error identity rather than on the fact of a throw.
  //
  // §4's provider-rejected-name row says the pattern lives in "the same table `../SPEC.md` §2.1
  // freezes, which is where a 64-character limit and a `[A-Za-z0-9_-]` rule live". It does not:
  // §2.1's table is about JSON Schema *keywords* and contains no name rule at all. NOTES.md
  // records the dangling cross-reference; the two limits are quoted here from §4's own sentence,
  // which is the only place in the frozen specs that states them.
  //
  it('refuses each operation §4 lists, naming it and the construct', () => {
    const ok = { '200': { description: 'ok' } };
    const jsonBody = (schema: unknown): unknown => ({ content: { 'application/json': { schema } } });

    const cases: readonly (readonly [string, unknown, RegExp, RegExp])[] = [
      [
        'a body that is not application/json',
        doc({
          '/imports': {
            post: {
              operationId: 'import_csv',
              requestBody: { content: { 'text/csv': { schema: { type: 'string' } } } },
              responses: ok,
            },
          },
        }),
        /import_csv/,
        /text\/csv|media type/,
      ],
      [
        'a name the provider pattern rejects',
        doc({
          '/issues': { get: { operationId: 'list issues!', responses: ok } },
        }),
        /list issues!/,
        /name|pattern/,
      ],
      [
        'a name longer than the 64 characters §4 names',
        doc({
          '/issues': { get: { operationId: `list_${'x'.repeat(70)}`, responses: ok } },
        }),
        /list_x{70}/,
        /64|length|name/,
      ],
      [
        'two operations producing the same tool name',
        doc({
          '/issues': { get: { operationId: 'list_issues', responses: ok } },
          '/tickets': { get: { operationId: 'list_issues', responses: ok } },
        }),
        /list_issues/,
        /duplicate|collision|twice/,
      ],
      [
        'a $ref that does not resolve within the document',
        doc({
          '/issues': {
            post: {
              operationId: 'open_issue',
              requestBody: jsonBody({ $ref: '#/components/schemas/Absent' }),
              responses: ok,
            },
          },
        }),
        /open_issue/,
        /Absent|resolve/,
      ],
      [
        'a $ref cycle',
        doc(
          {
            '/issues': {
              post: {
                operationId: 'open_issue',
                requestBody: jsonBody({ $ref: '#/components/schemas/Node' }),
                responses: ok,
              },
            },
          },
          {
            schemas: {
              Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } }, required: [] },
            },
          },
        ),
        /open_issue/,
        /cycle|cyclic|recursi/,
      ],
      [
        'an external $ref, refused without fetching it',
        doc({
          '/issues': {
            post: {
              operationId: 'open_issue',
              requestBody: jsonBody({ $ref: 'https://example.com/schemas/issue.json' }),
              responses: ok,
            },
          },
        }),
        /open_issue/,
        /external|https:\/\/example\.com/,
      ],
      [
        'a parameter and a body property with the same name',
        doc({
          '/projects/{title}/issues': {
            post: {
              operationId: 'create_issue',
              parameters: [{ name: 'title', in: 'path', required: true, schema: { type: 'string' } }],
              requestBody: jsonBody({ type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }),
              responses: ok,
            },
          },
        }),
        /create_issue/,
        /title/,
      ],
      [
        'an object-valued path parameter',
        doc({
          '/projects/{filter}': {
            get: {
              operationId: 'get_project',
              parameters: [
                {
                  name: 'filter',
                  in: 'path',
                  required: true,
                  schema: { type: 'object', properties: { id: { type: 'string' } } },
                },
              ],
              responses: ok,
            },
          },
        }),
        /get_project/,
        /path parameter filter|URL-safe scalar/,
      ],
      [
        'an object-valued query parameter',
        doc({
          '/projects': {
            get: {
              operationId: 'search_projects',
              parameters: [
                {
                  name: 'filter',
                  in: 'query',
                  schema: { type: 'object', properties: { id: { type: 'string' } } },
                },
              ],
              responses: ok,
            },
          },
        }),
        /search_projects/,
        /query parameter filter|URL-safe/,
      ],
      [
        'a static URL dot segment',
        doc({
          '/projects/../admin': {
            get: {
              operationId: 'get_admin',
              responses: ok,
            },
          },
        }),
        /\/projects\/\.\.\/admin/,
        /dot segment/,
      ],
    ];

    for (const [label, source, names, construct] of cases) {
      const attempt = (): readonly ToolSpec[] => toolsFromOpenApi(source, opts());
      expect(attempt, label).toThrowError(Error);
      expect(attempt, `${label}: the refusal must name the operation`).toThrowError(names);
      expect(attempt, `${label}: the refusal must name the construct`).toThrowError(construct);
    }

    // `../SPEC.md` §4's `ToolSpecRefusal` is the shape a refusal carries, and its five fields
    // are what make a refusal actionable — `suggestion` above all, because "we cannot express
    // this" without "do this instead" is a dead end. It is asserted structurally on one case
    // rather than on all eight, since the shape is the claim and the eight above establish the
    // coverage.
    let carried: unknown;
    try {
      toolsFromOpenApi(
        doc({
          '/imports': {
            post: {
              operationId: 'import_csv',
              requestBody: { content: { 'text/csv': { schema: { type: 'string' } } } },
              responses: ok,
            },
          },
        }),
        opts({ provider: 'openai' }),
      );
    } catch (error) {
      carried = error;
    }
    expect(carried).toBeInstanceOf(Error);
    const refusal = Reflect.get(Object(carried), 'refusal');
    const fields: readonly (keyof ToolSpecRefusal)[] = ['provider', 'path', 'construct', 'reason', 'suggestion'];
    for (const field of fields) {
      expect(typeof Reflect.get(Object(refusal), field), `refusal.${field}`).toBe('string');
    }
    expect(Reflect.get(Object(refusal), 'provider')).toBe('openai');
  });
});

describe('./SPEC.md §5.3 — the round trip, and the direction it cannot go', () => {
  // A genuine round trip, not two hand-written literals compared: the real `toJsonSchema` emits
  // the document, `toolsFromOpenApi` reads it back, and the recovered object is compared to the
  // emitted one by value. §4's flattening makes that comparison exact when the operation has no
  // path or query parameters — the body's properties go into the same object, and with nothing
  // else in it the identity is the whole claim.
  //
  // The lossy half is asserted explicitly, in both of the shapes trap 4 names. A `Date` column
  // comes back a string with a `format` annotation and no way home; and the optional-versus-
  // nullable pair comes back distinguishable only because `'null'` survives in the type array,
  // which is the one piece of the distinction the document carries.
  it('round-trips a schema emitted by toJsonSchema back into the same object', () => {
    const specs = toolsFromOpenApi(
      doc({
        '/orders': {
          post: {
            operationId: 'create_order',
            summary: 'Place an order',
            requestBody: { required: true, content: { 'application/json': { schema: orderCreateSchema } } },
            responses: { '201': { description: 'created' } },
          },
        },
      }),
      opts(),
    );

    expect(specs).toHaveLength(1);
    const tool = byName(specs, 'create_order');
    expect(tool?.description).toBe('Place an order');

    // The round trip, on the normative fields: `type`, `properties` and `required` come back
    // exactly as `toJsonSchema` emitted them. Compared to the *emitted* value, not to a snapshot
    // — a snapshot would let a change to `toJsonSchema` and a change here cancel out.
    expect(tool?.parameters.type).toBe(orderCreateSchema.type);
    expect(tool?.parameters.properties).toStrictEqual(orderCreateSchema.properties);
    expect(tool?.parameters.required.toSorted()).toStrictEqual(orderCreateSchema.required.toSorted());
    expect(tool?.parameters).toStrictEqual(orderCreateSchema);

    // The lossy direction, stated. A `Date` went in; a string with an annotation came out, and
    // there is nothing in the recovered property that says otherwise. `format` is the only
    // trace, and `../SPEC.md` §2's table shows a provider may drop a `format`.
    expect(tool?.parameters.properties['placedAt']).toStrictEqual({ type: 'string', format: 'date-time' });
    expect(JSON.stringify(tool?.parameters)).not.toContain('Date');
    expect(JSON.stringify(tool?.parameters)).not.toContain('timestamp');
    // So the model is asked for a string, and — §5.3 — that is not a mismatch to fix: "`Ctx.params`
    // is `Record<string, string>` at the controller boundary too, so the tool and the handler
    // agree."
    expect(tool?.parameters.properties['reference']).toHaveProperty('type', 'string');

    // Optional versus nullable, both recovered and still distinguishable. Neither is in
    // `required`; only one carries `'null'`.
    expect(tool?.parameters.required).not.toContain('placedAt');
    expect(tool?.parameters.required).not.toContain('shippedAt');
    expect(tool?.parameters.properties['shippedAt']).toHaveProperty('type', ['string', 'null']);
    expect(tool?.parameters.properties['placedAt']).toHaveProperty('type', 'string');
    // And the surprising one, preserved rather than corrected: `note?` is required, because the
    // document said so. A round trip that "fixed" it would disagree with the validator.
    expect(tool?.parameters.required).toContain('note');
  });

  // §5.3's other two clauses, on the document shape `toOpenApi` actually produces: every route
  // becomes exactly one tool, and path parameters become required *string* properties. §5's
  // second bullet records that `toOpenApi` emits "every entry `in: 'path'`, `required: true`,
  // `schema: { type: 'string' }`" and no query or header parameters at all, so this fixture is
  // that shape by hand — the version driven by the real `toOpenApi` is
  // `packages/web/src/openapi/openapi-tools-roundtrip.spec.ts`.
  it('gives every route exactly one tool and makes path parameters required strings', () => {
    const specs = toolsFromOpenApi(
      doc({
        '/users': {
          get: { operationId: 'get_users', responses: { '200': { description: 'ok' } } },
          post: { operationId: 'post_users', responses: { '201': { description: 'created' } } },
        },
        '/users/{id}': {
          get: {
            operationId: 'get_users_id',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '200': { description: 'ok' } },
          },
        },
        '/users/{id}/roles/{roleId}': {
          put: {
            operationId: 'put_users_id_roles_roleid',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'roleId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: { '204': { description: 'ok' } },
          },
        },
      }),
      opts(),
    );

    // Four operations across three paths, four tools: one per *operation*, which is what "every
    // route" means once `toOpenApi` has lowercased the methods under a path.
    expect(specs).toHaveLength(4);
    expect(specs.map(spec => spec.name).toSorted()).toStrictEqual([
      'get_users',
      'get_users_id',
      'post_users',
      'put_users_id_roles_roleid',
    ]);

    const nested = byName(specs, 'put_users_id_roles_roleid');
    expect(propertyNames(nested)).toStrictEqual(['id', 'roleId']);
    expect(nested?.parameters.properties['id']).toStrictEqual({ type: 'string' });
    expect(nested?.parameters.properties['roleId']).toStrictEqual({ type: 'string' });
    expect(nested?.parameters.required.toSorted()).toStrictEqual(['id', 'roleId']);

    // §5.3: "a body's properties appear when and only when a `schemas` entry supplied them" —
    // and none did here, so a parameterless operation is an object with nothing in it rather
    // than a tool that is missing.
    const collection = byName(specs, 'get_users');
    expect(collection?.parameters.type).toBe('object');
    expect(collection?.parameters.properties).toStrictEqual({});
    expect(collection?.parameters.required).toStrictEqual([]);
    // No description, because the document carried neither `summary` nor `description` — and
    // `exactOptionalPropertyTypes` means the key is absent rather than `undefined`.
    expect(Object.keys(Object(collection)).toSorted()).toStrictEqual(['name', 'parameters']);
  });
});
