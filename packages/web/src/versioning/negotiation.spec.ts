import { describe, expect, it } from 'vitest';

import type { Span, SpanContext } from '../observability/index.js';
import { bodyText, createRouter, type Router } from '../pipeline/index.js';
import { Controller, Get, getRoutes } from '../routing/index.js';
import { Version, VersionNeutral } from './index.js';

const jsonBody = async (response: Awaited<ReturnType<Router['handle']>>): Promise<unknown> =>
  JSON.parse(await bodyText(response));

@Controller('/plain')
class PlainController {
  @Get('')
  list() {
    return 'plain';
  }
}

@Version('1')
@Controller('/posts')
class PostsV1 {
  @Get('')
  list() {
    return 'v1';
  }
}

@Version('2')
@Controller('/posts')
class PostsV2 {
  @Get('')
  list() {
    return 'v2';
  }
}

@Version('1', '2')
@Controller('/multi')
class MultiVersionController {
  @Get('')
  list() {
    return 'both';
  }
}

@VersionNeutral()
@Controller('/health')
class HealthController {
  @Get('')
  check() {
    return 'ok';
  }
}

@VersionNeutral()
@Controller('/shadow')
class NeutralShadowController {
  @Get('')
  read() {
    return 'neutral';
  }
}

@Version('1')
@Controller('/shadow')
class VersionedShadowController {
  @Get('')
  read() {
    return 'versioned';
  }
}

@VersionNeutral()
@Controller('/mixed-order')
class NeutralParameterController {
  @Get('/:id')
  read() {
    return 'neutral-parameter';
  }
}

@Version('1')
@Controller('/mixed-order')
class VersionedFixedController {
  @Get('/fixed')
  read() {
    return 'versioned-fixed';
  }
}

@VersionNeutral()
@Controller('/nearer')
class NeutralController {
  @Version('2')
  @Get('/specific')
  specific() {
    return 'specific-v2';
  }

  @Get('/neutral')
  neutral() {
    return 'neutral';
  }
}

@Version('1')
@Controller('/nearer-other')
class VersionedController {
  @VersionNeutral()
  @Get('/neutral')
  neutral() {
    return 'neutral';
  }

  @Get('/specific')
  specific() {
    return 'specific-v1';
  }
}

class InheritedVersionBase {
  @Version('2')
  @Get('/read')
  read() {
    return 'inherited-v2';
  }
}

@Version('1')
@Controller('/inherited')
class InheritedVersionController extends InheritedVersionBase {}

@Version('1')
@Controller('/order')
class OrderedController {
  @Get('/:id')
  byId() {
    return 'parameter';
  }

  @Get('/fixed')
  fixed() {
    return 'fixed';
  }
}

@Version('1')
@Controller('/duplicate')
class DuplicateOne {
  @Get('')
  read() {
    return 1;
  }
}

@Version('1')
@Controller('/duplicate')
class DuplicateTwo {
  @Get('')
  read() {
    return 2;
  }
}

@Version('2')
@Controller('/deferred')
class DeferredController {
  @Get('')
  read() {
    return 'deferred-v2';
  }
}

@Version('1')
@Controller('/perf')
class OneVersionPerf {
  @Get('/a')
  a() {
    return 'a';
  }

  @Get('/b')
  b() {
    return 'b';
  }

  @Get('/target')
  target() {
    return 'target';
  }
}

@Version('1', '2', '3', '4', '5', '6', '7', '8')
@Controller('/perf')
class ManyVersionPerf {
  @Get('/a')
  a() {
    return 'a';
  }

  @Get('/b')
  b() {
    return 'b';
  }

  @Get('/target')
  target() {
    return 'target';
  }
}

function headerRouter() {
  const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
  router.register(new PostsV1());
  router.register(new PostsV2());
  return router;
}

function mediaTypeRouter() {
  const router = createRouter({ versioning: { kind: 'media-type', key: 'version', default: '1' } });
  router.register(new PostsV1());
  router.register(new PostsV2());
  return router;
}

function countingPath(value: string): { readonly path: string; readonly reads: () => number } {
  let reads = 0;
  const path = {
    length: value.length,
    charCodeAt(index: number): number {
      reads += 1;
      return value.charCodeAt(index);
    },
    indexOf(search: string, from?: number): number {
      reads += 1;
      return value.indexOf(search, from);
    },
    slice(start?: number, end?: number): string {
      reads += 1;
      return value.slice(start, end);
    },
  } as unknown as string;
  return { path, reads: () => reads };
}

function allocationGuardHeader(value: string): { readonly value: string; readonly reads: () => number } {
  let reads = 0;
  const guarded = {
    length: value.length,
    charCodeAt(index: number): number {
      reads += 1;
      return value.charCodeAt(index);
    },
    slice(): never {
      throw new Error('known-version extraction must not slice');
    },
    split(): never {
      throw new Error('known-version extraction must not split');
    },
    substring(): never {
      throw new Error('known-version extraction must not substring');
    },
    toLowerCase(): never {
      throw new Error('known-version extraction must not allocate a lower-cased copy');
    },
    trim(): never {
      throw new Error('known-version extraction must not allocate a trimmed copy');
    },
  } as unknown as string;
  return { value: guarded, reads: () => reads };
}

const TRACE_CONTEXT: SpanContext = {
  traceId: '00000000000000000000000000000001',
  spanId: '0000000000000001',
  traceFlags: 1,
};

const NOOP_SPAN: Span = {
  updateName: () => undefined,
  setAttribute: () => undefined,
  recordException: () => undefined,
  setStatus: () => undefined,
  end: () => undefined,
  spanContext: () => TRACE_CONTEXT,
};

describe('version declarations', () => {
  it('refuses a route with no version declaration under a configured strategy', () => {
    const register = () =>
      createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } }).register(
        new PlainController(),
      );
    expect(register).toThrow(/PlainController/);
    expect(register).toThrow(/\blist\b/);
    expect(register).toThrow(/@Version.*@VersionNeutral/);
  });

  it('refuses @Version when no version strategy is configured', () => {
    expect(() => createRouter().register(new PostsV1())).toThrow(/PostsV1\.list/);
    expect(() => createRouter().register(new PostsV1())).toThrow(/createRouter.*versioning/);
  });

  it('keeps an unconfigured router on method and path alone', async () => {
    @Controller('/v1/posts')
    class ManualV1 {
      @Get('')
      list() {
        return 'manual-v1';
      }
    }

    const router = createRouter();
    router.register(new ManualV1());
    const known = await router.handle({ method: 'GET', path: '/v1/posts', headers: { 'accept-version': '9' } });
    const unknown = await router.handle({ method: 'GET', path: '/v9/posts', headers: {} });
    expect(`${known.status} ${await bodyText(known)}`).toBe('200 "manual-v1"');
    expect(`${unknown.status} ${await bodyText(unknown)}`).toBe('404 {"error":"no route for GET /v9/posts"}');
  });

  it('uses the method declaration instead of a neutral controller declaration', async () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new NeutralController());
    const v2 = await router.handle({
      method: 'GET',
      path: '/nearer/specific',
      headers: { 'accept-version': '2' },
    });
    const v1 = await router.handle({
      method: 'GET',
      path: '/nearer/specific',
      headers: { 'accept-version': '1' },
    });
    expect(`${v2.status} ${await bodyText(v2)} | ${v1.status}`).toBe('200 "specific-v2" | 400');
  });

  it('uses a neutral method instead of its controller version', async () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new VersionedController());
    const unknown = await router.handle({
      method: 'GET',
      path: '/nearer-other/neutral',
      headers: { 'accept-version': '99' },
    });
    const wrong = await router.handle({
      method: 'GET',
      path: '/nearer-other/specific',
      headers: { 'accept-version': '2' },
    });
    expect(`${unknown.status} ${await bodyText(unknown)} | ${wrong.status}`).toBe('200 "neutral" | 400');
  });

  it('keeps an inherited method declaration ahead of the derived class declaration', async () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new InheritedVersionController());
    const v2 = await router.handle({
      method: 'GET',
      path: '/inherited/read',
      headers: { 'accept-version': '2' },
    });
    const v1 = await router.handle({
      method: 'GET',
      path: '/inherited/read',
      headers: { 'accept-version': '1' },
    });
    expect(`${v2.status} ${await bodyText(v2)} | ${v1.status}`).toBe('200 "inherited-v2" | 400');
  });
});

describe('path versioning', () => {
  it('expands one multi-version route at registration and leaves routing metadata unchanged', async () => {
    const metadataBefore = getRoutes(MultiVersionController);
    const router = createRouter({ versioning: { kind: 'path', prefix: 'v' } });
    router.register(new MultiVersionController());

    const v1 = await router.handle({ method: 'GET', path: '/v1/multi', headers: {} });
    const v2 = await router.handle({ method: 'GET', path: '/v2/multi', headers: {} });
    const bare = await router.handle({ method: 'GET', path: '/multi', headers: {} });
    const unknown = await router.handle({ method: 'GET', path: '/v9/multi', headers: {} });

    expect(`${v1.status} ${await bodyText(v1)} | ${v2.status} ${await bodyText(v2)}`).toBe('200 "both" | 200 "both"');
    expect(`${bare.status} ${unknown.status} ${await bodyText(unknown)}`).toBe(
      '404 404 {"error":"no route for GET /v9/multi"}',
    );
    expect(getRoutes(MultiVersionController)).toEqual(metadataBefore);
  });

  it('keeps an explicitly neutral hand-versioned path unchanged', async () => {
    @VersionNeutral()
    @Controller('/v1/manual')
    class ManualController {
      @Get('')
      list() {
        return 'manual';
      }
    }

    const router = createRouter({ versioning: { kind: 'path', prefix: 'v' } });
    router.register(new ManualController());
    const response = await router.handle({ method: 'GET', path: '/v1/manual', headers: {} });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "manual"');
  });
});

describe('header versioning', () => {
  it('uses the configured default when the request names no version', async () => {
    const response = await headerRouter().handle({ method: 'GET', path: '/posts', headers: {} });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v1"');
  });

  it('routes a request to the handler for its declared version', async () => {
    const response = await headerRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { 'accept-version': '2' },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v2"');
  });

  it('runs route guards only for the selected version', async () => {
    const calls: string[] = [];
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new PostsV1(), {
      list: {
        guards: [
          {
            canActivate: () => {
              calls.push('v1');
              return true;
            },
          },
        ],
      },
    });
    router.register(new PostsV2(), {
      list: {
        guards: [
          {
            canActivate: () => {
              calls.push('v2');
              return true;
            },
          },
        ],
      },
    });

    const response = await router.handle({
      method: 'GET',
      path: '/posts',
      headers: { 'accept-version': '2' },
    });
    expect(`${response.status} ${await bodyText(response)} ${calls.join(',')}`).toBe('200 "v2" v2');
  });

  it('returns 400 with the route-specific supported versions for an unknown version', async () => {
    const response = await headerRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { 'accept-version': '9' },
    });
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toEqual({
      error: 'unsupported version "9"',
      supported: ['1', '2'],
    });
  });

  it('keeps an unknown path a uniform 404 rather than leaking unrelated versions', async () => {
    const response = await headerRouter().handle({
      method: 'GET',
      path: '/missing',
      headers: { 'accept-version': '9' },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('404 {"error":"no route for GET /missing"}');
  });

  it('lets a version-specific route shadow a neutral route regardless of registration order', async () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new NeutralShadowController());
    router.register(new VersionedShadowController());

    const v1 = await router.handle({
      method: 'GET',
      path: '/shadow',
      headers: { 'accept-version': '1' },
    });
    const v2 = await router.handle({
      method: 'GET',
      path: '/shadow',
      headers: { 'accept-version': '2' },
    });
    expect(`${await bodyText(v1)} ${await bodyText(v2)}`).toBe('"versioned" "neutral"');
  });

  it('preserves registration order between different neutral and versioned patterns', async () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new NeutralParameterController());
    router.register(new VersionedFixedController());

    const response = await router.handle({
      method: 'GET',
      path: '/mixed-order/fixed',
      headers: { 'accept-version': '1' },
    });
    expect(await bodyText(response)).toBe('"neutral-parameter"');
  });

  it('lets a neutral route answer a version no route declares', async () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new HealthController());
    const response = await router.handle({
      method: 'GET',
      path: '/health',
      headers: { 'accept-version': '2099-01-01' },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "ok"');
  });

  it('preserves first-registered route ordering within one version bucket', async () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new OrderedController());
    const response = await router.handle({
      method: 'GET',
      path: '/order/fixed',
      headers: { 'accept-version': '1' },
    });
    expect(await bodyText(response)).toBe('"parameter"');
  });

  it('refuses two routes with the same method, path and version', () => {
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.register(new DuplicateOne());
    expect(() => router.register(new DuplicateTwo())).toThrow(/DuplicateTwo\.read/);
    expect(() => router.register(new DuplicateTwo())).toThrow(/GET \/duplicate.*version "1"/);
  });

  it('keeps deferred construction behind the selected version', async () => {
    let constructions = 0;
    const router = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    router.registerDeferred(DeferredController, async () => {
      constructions += 1;
      return new DeferredController();
    });

    const wrong = await router.handle({
      method: 'GET',
      path: '/deferred',
      headers: { 'accept-version': '1' },
    });
    expect(`${wrong.status} ${constructions}`).toBe('400 0');

    const selected = await router.handle({
      method: 'GET',
      path: '/deferred',
      headers: { 'accept-version': '2' },
    });
    expect(`${selected.status} ${await bodyText(selected)} ${constructions}`).toBe('200 "deferred-v2" 1');
  });

  it('uses the same versioned table when request tracing is configured', async () => {
    const router = createRouter({
      versioning: { kind: 'header', name: 'accept-version', default: '1' },
      tracer: { startSpan: () => NOOP_SPAN },
    });
    router.register(new PostsV2());
    const response = await router.handle({
      method: 'GET',
      path: '/posts',
      headers: { 'accept-version': '2' },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v2"');
  });
});

describe('media-type versioning', () => {
  it('uses the configured default when Accept names no version', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { accept: 'application/json' },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v1"');
  });

  it('selects the highest-quality acceptable version', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: {
        accept: 'application/json;version=2;q=0.1, application/json;version=1;q=0.9',
      },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v1"');
  });

  it('selects a supported version when a higher-quality range names an unknown one', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: {
        accept: 'application/json;version=9, application/json;version=2;q=0.5',
      },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v2"');
  });

  it('treats q=0 as a prohibition rather than selecting that version', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { accept: 'application/json;version=1;q=0' },
    });
    expect(response.status).toBe(406);
    expect(await jsonBody(response)).toEqual({
      error: 'unsupported version "1"',
      supported: ['1', '2'],
    });
  });

  it('keeps q=0 prohibitive when the same version also appears without it', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: {
        accept: 'application/json;version=1, application/json;version=1;q=0',
      },
    });
    expect(response.status).toBe(406);
    expect(await jsonBody(response)).toEqual({
      error: 'unsupported version "1"',
      supported: ['1', '2'],
    });
  });

  it('returns 406 with supported versions for an unknown media-type version', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { accept: 'application/json;version=9' },
    });
    expect(response.status).toBe(406);
    expect(await jsonBody(response)).toEqual({
      error: 'unsupported version "9"',
      supported: ['1', '2'],
    });
  });

  it('does not read a version from Content-Type', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { 'content-type': 'application/json;version=2' },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v1"');
  });

  it('returns the selected version in the JSON response media type', async () => {
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { accept: 'application/json;version=2' },
    });
    expect(response.headers['content-type']).toBe('application/json; version=2');
  });

  it('extracts a known media-type version without string-allocation helpers', async () => {
    const accept = allocationGuardHeader('application/json; Version="2"; q=1.000');
    const response = await mediaTypeRouter().handle({
      method: 'GET',
      path: '/posts',
      headers: { accept: accept.value },
    });
    expect(`${response.status} ${await bodyText(response)}`).toBe('200 "v2"');
    expect(accept.reads()).toBeGreaterThan(0);
  });
});

describe('startup-built resolution', () => {
  it('does not inspect more path candidates when other versions are registered', async () => {
    const one = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    one.register(new OneVersionPerf());
    const onePath = countingPath('/perf/target');
    const oneResponse = await one.handle({
      method: 'GET',
      path: onePath.path,
      headers: { 'accept-version': '1' },
    });

    const many = createRouter({ versioning: { kind: 'header', name: 'accept-version', default: '1' } });
    many.register(new ManyVersionPerf());
    const manyPath = countingPath('/perf/target');
    const manyResponse = await many.handle({
      method: 'GET',
      path: manyPath.path,
      headers: { 'accept-version': '1' },
    });

    expect(`${await bodyText(oneResponse)} ${await bodyText(manyResponse)}`).toBe('"target" "target"');
    expect(manyPath.reads()).toBe(onePath.reads());
  });
});
