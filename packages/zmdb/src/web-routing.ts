// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

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
