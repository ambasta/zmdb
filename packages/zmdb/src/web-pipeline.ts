// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

// zmdb/web/pipeline — curated router, response, and runtime-adapter facade.
export {
  bodyText,
  bytes,
  createRouter,
  file,
  json,
  respond,
  stream,
  text,
  toFetchHandler,
  toNodeHandler,
} from '@zmdb/web/pipeline';
export type {
  AdapterOptions,
  CorsPolicy,
  Ctx,
  FileResponseOptions,
  GuardRegistry,
  HttpPolicy,
  ResponseBody,
  ResponseOptions,
  RouteOptions,
  Router,
  RouterOptions,
  SecurityRequirement,
  StreamOptions,
  WebRequest,
  WebResponse,
} from '@zmdb/web/pipeline';
