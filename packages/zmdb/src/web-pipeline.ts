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
  Ctx,
  FileResponseOptions,
  GuardRegistry,
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
