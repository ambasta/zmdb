// Tests (#254) for controllers & routing — RED first (routing exports don't
// exist yet). Verifies route metadata recording, prefix composition, declaration
// order, and no-reflection reads. Per packages/web/src/routing/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Controller, Get, Post, Put, Patch, Delete, getRoutes } from './index.js';

describe('@zmdb/web routing: decorators + getRoutes', () => {
  it('records routes with composed paths in declaration order', () => {
    @Controller('/users')
    class UsersController {
      @Get('/:id')
      get() {}
      @Post()
      create() {}
      @Patch('/:id')
      patch() {}
      @Delete('/:id')
      remove() {}
      @Put('/:id')
      replace() {}
    }

    const routes = getRoutes(UsersController);
    expect(routes).toEqual([
      { method: 'GET', path: '/users/:id', handlerName: 'get' },
      { method: 'POST', path: '/users', handlerName: 'create' },
      { method: 'PATCH', path: '/users/:id', handlerName: 'patch' },
      { method: 'DELETE', path: '/users/:id', handlerName: 'remove' },
      { method: 'PUT', path: '/users/:id', handlerName: 'replace' },
    ]);
  });

  it('composes an empty prefix and root paths correctly', () => {
    @Controller()
    class HealthController {
      @Get('/health')
      health() {}
      @Get()
      root() {}
    }

    expect(getRoutes(HealthController)).toEqual([
      { method: 'GET', path: '/health', handlerName: 'health' },
      { method: 'GET', path: '/', handlerName: 'root' },
    ]);
  });

  it('collapses duplicate slashes and strips trailing slashes', () => {
    @Controller('users/')
    class C {
      @Get('/')
      list() {}
    }
    expect(getRoutes(C)).toEqual([{ method: 'GET', path: '/users', handlerName: 'list' }]);
  });

  it('returns an empty list for a controller with no routes', () => {
    @Controller('/empty')
    class Empty {}
    expect(getRoutes(Empty)).toEqual([]);
  });

  it('captures co-located route schemas attached to route decorators', () => {
    const bodySchema = { type: 'object', properties: { name: { type: 'string' } } };
    const responseSchema = { type: 'object', properties: { id: { type: 'number' } } };

    @Controller('/items')
    class ItemsController {
      @Post({ body: bodySchema, response: responseSchema })
      create() {}

      @Get('/:id', { schema: { response: responseSchema } })
      getOne() {}
    }

    const routes = getRoutes(ItemsController);
    expect(routes[0]?.schema).toEqual({ body: bodySchema, response: responseSchema });
    expect(routes[1]?.schema).toEqual({ response: responseSchema });
  });
});

// #607. A subclass's metadata record has the base's as its prototype, so a writer
// that pushes into the array it reads writes the subclass's routes into the base —
// and, through it, into every sibling subclass.
describe('@zmdb/web routing: getRoutes across a class hierarchy', () => {
  it('keeps two sibling subclasses out of each other and out of the base', () => {
    @Controller('/base')
    class BaseController {
      @Get('/ping')
      ping() {}
    }

    @Controller('/admin')
    class AdminController extends BaseController {
      @Get('/stats')
      stats() {}
    }

    @Controller('/public')
    class PublicController extends BaseController {
      @Get('/health')
      health() {}
    }

    expect(getRoutes(BaseController).map(route => route.path)).toEqual(['/base/ping']);
    expect(getRoutes(AdminController).map(route => route.path)).toEqual(['/admin/ping', '/admin/stats']);
    expect(getRoutes(PublicController).map(route => route.path)).toEqual(['/public/ping', '/public/health']);
  });

  it('inherits the base routes under the subclass prefix, base first', () => {
    @Controller('/base')
    class BaseController {
      @Get('/list')
      list() {}
      @Post()
      create() {}
    }

    @Controller('/v2')
    class V2Controller extends BaseController {
      @Get('/items')
      items() {}
    }

    expect(getRoutes(V2Controller)).toEqual([
      { method: 'GET', path: '/v2/list', handlerName: 'list' },
      { method: 'POST', path: '/v2', handlerName: 'create' },
      { method: 'GET', path: '/v2/items', handlerName: 'items' },
    ]);
  });

  it('renames rather than duplicates when a subclass overrides a handler', () => {
    @Controller('/base')
    class BaseController {
      @Get('/list')
      list() {
        return 'base.list';
      }
    }

    @Controller('/v2')
    class V2Controller extends BaseController {
      @Get('/items')
      override list() {
        return 'v2.list';
      }
    }

    // /base/items would be a route nobody declared, and /v2/list the path the
    // override was renaming away from. Neither may appear.
    expect(getRoutes(BaseController)).toEqual([{ method: 'GET', path: '/base/list', handlerName: 'list' }]);
    expect(getRoutes(V2Controller)).toEqual([{ method: 'GET', path: '/v2/items', handlerName: 'list' }]);
  });

  it('keeps every verb a subclass declares for one handler', () => {
    @Controller('/base')
    class BaseController {
      @Get('/list')
      list() {}
    }

    // Two decorators on one method: both are own declarations, so both survive the
    // rename of the inherited /list. They are applied bottom-up, so @Post records
    // first — a stage-3 property, not something this module chooses.
    @Controller('/v2')
    class V2Controller extends BaseController {
      @Get('/items')
      @Post('/items')
      override list() {}
    }

    expect(getRoutes(V2Controller)).toEqual([
      { method: 'POST', path: '/v2/items', handlerName: 'list' },
      { method: 'GET', path: '/v2/items', handlerName: 'list' },
    ]);
  });

  it('does not change the base route table when a subclass is evaluated', () => {
    @Controller('/base')
    class BaseController {
      @Get('/list')
      list() {}
    }

    const before = getRoutes(BaseController);

    @Controller('/v2')
    class V2Controller extends BaseController {
      @Get('/items')
      items() {}
    }

    // Otherwise the route table depends on which subclass modules an entry point
    // happens to have imported.
    expect(getRoutes(BaseController)).toEqual(before);
    expect(getRoutes(V2Controller).map(route => route.path)).toEqual(['/v2/list', '/v2/items']);
  });

  it('inherits the prefix when the subclass omits @Controller', () => {
    @Controller('/base')
    class BaseController {
      @Get('/list')
      list() {}
    }

    class SilentController extends BaseController {
      @Get('/extra')
      extra() {}
    }

    expect(getRoutes(SilentController).map(route => route.path)).toEqual(['/base/list', '/base/extra']);
  });
});
