// zmdb OpenAPI 3.0 specification generator for documentation site artifact publishing.
// Derives OpenAPI components and path schemas directly from core schema definitions.
//
// The four shapes live in `./openapi-model.ts` as interfaces, because that is where a shape
// is declared now; this file is the document. It re-exports them so the split is invisible
// to anything that imported a schema from here.

import { toJsonSchema, toOpenApiComponents, toListSchema, toSearchSchema } from '@zmdb/schema-core/openapi';

import { OrderSchema, ProductSchema, ProfileSchema, UserSchema } from './openapi-model.ts';

export { OrderSchema, ProductSchema, ProfileSchema, UserSchema };

export function generateOpenApiSpec() {
  const components = toOpenApiComponents([UserSchema, OrderSchema, ProductSchema, ProfileSchema]);
  return {
    openapi: '3.0.3',
    info: {
      title: 'zmdb API Specification',
      version: '1.0.0',
      description: 'Auto-generated OpenAPI specification from zmdb core schema definitions.',
    },
    paths: {
      '/users': {
        get: {
          summary: 'List users',
          operationId: 'listUsers',
          responses: {
            200: {
              description: 'A paginated list of users',
              content: {
                'application/json': {
                  schema: toListSchema(UserSchema),
                },
              },
            },
          },
        },
        post: {
          summary: 'Create user',
          operationId: 'createUser',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: toJsonSchema(UserSchema, 'create'),
              },
            },
          },
          responses: {
            201: {
              description: 'Created user',
              content: {
                'application/json': {
                  schema: toJsonSchema(UserSchema, 'entity'),
                },
              },
            },
          },
        },
      },
      '/users/search': {
        get: {
          summary: 'Search users',
          operationId: 'searchUsers',
          responses: {
            200: {
              description: 'User search results with relevance scores',
              content: {
                'application/json': {
                  schema: toSearchSchema(UserSchema),
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        get: {
          summary: 'Get user by ID',
          operationId: 'getUserById',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            200: {
              description: 'User details',
              content: {
                'application/json': {
                  schema: toJsonSchema(UserSchema, 'get'),
                },
              },
            },
          },
        },
        patch: {
          summary: 'Update user',
          operationId: 'updateUser',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: toJsonSchema(UserSchema, 'update'),
              },
            },
          },
          responses: {
            200: {
              description: 'Updated user',
              content: {
                'application/json': {
                  schema: toJsonSchema(UserSchema, 'entity'),
                },
              },
            },
          },
        },
      },
      '/orders': {
        get: {
          summary: 'List orders',
          operationId: 'listOrders',
          responses: {
            200: {
              description: 'A paginated list of orders',
              content: {
                'application/json': {
                  schema: toListSchema(OrderSchema),
                },
              },
            },
          },
        },
        post: {
          summary: 'Create order',
          operationId: 'createOrder',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: toJsonSchema(OrderSchema, 'create'),
              },
            },
          },
          responses: {
            201: {
              description: 'Created order',
              content: {
                'application/json': {
                  schema: toJsonSchema(OrderSchema, 'entity'),
                },
              },
            },
          },
        },
      },
    },
    components,
  };
}
