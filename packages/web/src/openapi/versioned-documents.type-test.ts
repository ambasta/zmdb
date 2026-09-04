import type { Equal, Expect } from '@zmdb/schema-core';

import type { VersionStrategy } from '../versioning/index.js';
import type { OpenApiOptions, RouteSchemas, VersionSchemas } from './index.js';

type FrozenVersionSchemas = Readonly<Record<string, Readonly<Record<string, RouteSchemas>>>>;

export type _VersionSchemasShape = Expect<Equal<VersionSchemas, FrozenVersionSchemas>>;
export type _DocumentStrategy = Expect<Equal<OpenApiOptions['versioning'], VersionStrategy | undefined>>;
export type _DocumentVersionSchemas = Expect<Equal<OpenApiOptions['versionSchemas'], FrozenVersionSchemas | undefined>>;

const headerDocument: OpenApiOptions = {
  versioning: { kind: 'header', name: 'accept-version', default: '1' },
  versionSchemas: {
    '/posts': {
      '1': { response: { type: 'array' } },
      '2': { response: { type: 'object' } },
    },
  },
};
void headerDocument;

const mediaDocument: OpenApiOptions = {
  versioning: { kind: 'media-type', key: 'version', default: '1' },
  versionSchemas: {
    '/posts': {
      '1': { body: { type: 'object' }, response: { type: 'array' } },
      '2': { body: { type: 'object' }, response: { type: 'object' } },
    },
  },
};
void mediaDocument;

const pathDocument: OpenApiOptions = {
  versioning: { kind: 'path', prefix: 'v' },
  schemas: {
    '/v1/posts': { response: { type: 'array' } },
    '/v2/posts': { response: { type: 'object' } },
  },
};
void pathDocument;

const invalidDocument: OpenApiOptions = {
  // @ts-expect-error — the document and router accept exactly one strategy
  versioning: [
    { kind: 'path', prefix: 'v' },
    { kind: 'header', name: 'accept-version', default: '1' },
  ],
};
void invalidDocument;
