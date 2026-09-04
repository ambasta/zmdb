import { Validator } from '@seriousme/openapi-schema-validator';
import { describe, expect, it } from 'vitest';

import { Controller, Get } from '../routing/index.js';
import { Version, VersionNeutral } from '../versioning/index.js';
import { toOpenApi, type OpenApiDocument, type VersionSchemas } from './index.js';

@Version('1', '2')
@Controller('/posts')
class PostsController {
  @Get('')
  list() {
    return [];
  }
}

@Version('1')
@Controller('/split')
class SplitV1Controller {
  @Get('')
  read() {
    return { version: 1 };
  }
}

@Version('2')
@Controller('/split')
class SplitV2Controller {
  @Get('')
  read() {
    return { version: 2 };
  }
}

@Version('2')
@Controller('/only-v2')
class OnlyV2Controller {
  @Get('')
  read() {
    return { version: 2 };
  }
}

@VersionNeutral()
@Controller('/health')
class HealthController {
  @Get('')
  read() {
    return { ok: true };
  }
}

@Version('1')
@Controller('/health')
class VersionedHealthController {
  @Get('')
  read() {
    return { version: 1 };
  }
}

@Controller('/undeclared')
class UndeclaredController {
  @Get('')
  read() {
    return {};
  }
}

const INFO = { title: 'Versioned API', version: '1.0.0' };
const STRING_LIST = { type: 'array', items: { type: 'string' } };
const OBJECT = { type: 'object', properties: { id: { type: 'string' } } };
const COMMON_BODY = { type: 'object', properties: { title: { type: 'string' } } };

const IDENTICAL_VERSION_SCHEMAS: VersionSchemas = {
  '/posts': {
    '1': { body: COMMON_BODY, response: STRING_LIST },
    '2': { body: COMMON_BODY, response: STRING_LIST },
  },
};

async function validateOpenApi(document: OpenApiDocument): Promise<void> {
  const validator = new Validator();
  const json: Record<string, unknown> = JSON.parse(JSON.stringify(document));
  const result = await validator.validate(json);
  expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  expect(validator.version).toBe('3.1');
}

describe('versioned OpenAPI documents', () => {
  it('expands path versions into independent valid operations with independent schemas', async () => {
    const document = toOpenApi([PostsController], {
      info: INFO,
      versioning: { kind: 'path', prefix: 'v' },
      schemas: {
        '/v1/posts': { response: STRING_LIST },
        '/v2/posts': { response: OBJECT },
      },
    });

    expect(Object.keys(document.paths)).toEqual(['/v1/posts', '/v2/posts']);
    expect(document.paths['/v1/posts']?.get?.operationId).toBe('get_v1_posts');
    expect(document.paths['/v2/posts']?.get?.operationId).toBe('get_v2_posts');
    expect(document.paths['/v1/posts']?.get?.responses['200']?.content?.['application/json']?.schema).toEqual(
      STRING_LIST,
    );
    expect(document.paths['/v2/posts']?.get?.responses['200']?.content?.['application/json']?.schema).toEqual(OBJECT);
    await validateOpenApi(document);
  });

  it('emits one valid header-versioned operation with an optional enum and default', async () => {
    const document = toOpenApi([PostsController], {
      info: INFO,
      versioning: { kind: 'header', name: 'accept-version', default: '1' },
      versionSchemas: IDENTICAL_VERSION_SCHEMAS,
    });

    expect(document.paths['/posts']?.get?.parameters).toEqual([
      {
        name: 'accept-version',
        in: 'header',
        required: false,
        schema: { enum: ['1', '2'], default: '1' },
      },
    ]);
    expect(document.paths['/posts']?.get?.responses['200']?.content?.['application/json']?.schema).toEqual(STRING_LIST);
    await validateOpenApi(document);
  });

  it('merges separately implemented header versions into one operation', () => {
    const document = toOpenApi([SplitV1Controller, SplitV2Controller], {
      versioning: { kind: 'header', name: 'accept-version', default: '1' },
      versionSchemas: {
        '/split': {
          '1': { response: OBJECT },
          '2': { response: OBJECT },
        },
      },
    });
    expect(Object.keys(document.paths)).toEqual(['/split']);
    expect(document.paths['/split']?.get?.parameters?.at(-1)?.schema).toEqual({
      enum: ['1', '2'],
      default: '1',
    });
  });

  it('emits versioned response media types while keeping the request Content-Type unversioned', async () => {
    const document = toOpenApi([PostsController], {
      info: INFO,
      versioning: { kind: 'media-type', key: 'version', default: '1' },
      versionSchemas: {
        '/posts': {
          '1': { body: COMMON_BODY, response: STRING_LIST },
          '2': { body: COMMON_BODY, response: OBJECT },
        },
      },
    });
    const operation = document.paths['/posts']?.get;

    expect(operation?.requestBody?.content).toEqual({
      'application/json': { schema: COMMON_BODY },
    });
    expect(operation?.responses['200']?.content).toEqual({
      'application/json; version=1': { schema: STRING_LIST },
      'application/json; version=2': { schema: OBJECT },
    });
    await validateOpenApi(document);
  });

  it('refuses differing header-versioned schemas and names path versioning', () => {
    const generate = () =>
      toOpenApi([PostsController], {
        versioning: { kind: 'header', name: 'accept-version', default: '1' },
        versionSchemas: {
          '/posts': {
            '1': { response: STRING_LIST },
            '2': { response: OBJECT },
          },
        },
      });
    expect(generate).toThrow(/header-versioned request or response schemas differ/);
    expect(generate).toThrow(/path versioning/);
  });

  it('refuses differing media-type request schemas because runtime ignores Content-Type versions', () => {
    const generate = () =>
      toOpenApi([PostsController], {
        versioning: { kind: 'media-type', key: 'version', default: '1' },
        versionSchemas: {
          '/posts': {
            '1': { body: STRING_LIST, response: OBJECT },
            '2': { body: OBJECT, response: STRING_LIST },
          },
        },
      });
    expect(generate).toThrow(/reads Accept rather than Content-Type/);
    expect(generate).toThrow(/path versioning/);
  });

  it('refuses an optional header default that the operation does not serve', () => {
    expect(() =>
      toOpenApi([OnlyV2Controller], {
        versioning: { kind: 'header', name: 'accept-version', default: '1' },
      }),
    ).toThrow(/default "1" is not served/);
  });

  it('documents a neutral route without a version parameter', async () => {
    const document = toOpenApi([HealthController], {
      info: INFO,
      versioning: { kind: 'header', name: 'accept-version', default: '1' },
      schemas: { '/health': { response: OBJECT } },
    });
    expect(document.paths['/health']?.get?.parameters).toBeUndefined();
    await validateOpenApi(document);
  });

  it('refuses neutral and specific shadowing that one OpenAPI operation cannot express', () => {
    expect(() =>
      toOpenApi([HealthController, VersionedHealthController], {
        versioning: { kind: 'header', name: 'accept-version', default: '1' },
      }),
    ).toThrow(/neutral and version-specific handlers/);
  });

  it('requires runtime and document generation to receive the same strategy decision', () => {
    expect(() => toOpenApi([PostsController])).toThrow(/OpenApiOptions\.versioning/);
    expect(() =>
      toOpenApi([UndeclaredController], {
        versioning: { kind: 'path', prefix: 'v' },
      }),
    ).toThrow(/declare @Version.*@VersionNeutral/);
  });

  it('is deterministic with version grouping and per-version schemas', () => {
    const options = {
      info: INFO,
      versioning: { kind: 'media-type', key: 'version', default: '1' },
      versionSchemas: IDENTICAL_VERSION_SCHEMAS,
    } as const;
    expect(JSON.stringify(toOpenApi([PostsController], options))).toBe(
      JSON.stringify(toOpenApi([PostsController], options)),
    );
  });
});
