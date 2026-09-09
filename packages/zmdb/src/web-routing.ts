// zmdb/web/routing — curated HTTP routing facade.
export {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Public,
  Put,
  getRoutes,
  isPublic,
  UseGuards,
  UsePipes,
  UseInterceptors,
  UseFilters,
  prepareMiddleware,
  middlewareFor,
} from '@zmdb/web/routing';
export type {
  HttpMethod,
  ResolvedRoute,
  RouteDefinition,
  MiddlewareDeclaration,
  MiddlewareDeclarations,
  MiddlewareResolver,
} from '@zmdb/web/routing';
