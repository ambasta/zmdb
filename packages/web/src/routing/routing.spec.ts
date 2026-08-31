// Tests (#254) for controllers & routing — RED first (routing exports don't
// exist yet). Verifies route metadata recording, prefix composition, declaration
// order, and no-reflection reads. Per packages/web/src/routing/SPEC.md.
import { describe, it, expect } from 'vitest';

import { Controller, Get, Post, Put, Patch, Delete, getRoutes } from './index.ts';

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
});
