// zmdb OpenAPI 3.0 specification generator for documentation site artifact publishing.
// Derives OpenAPI components and path schemas directly from core schema definitions.

import { tags } from '@zmdb/aot-validator';
import { defineSchema, serial, text, integer, numeric, jsonEnum, references } from '@zmdb/schema-core';
import { toJsonSchema, toOpenApiComponents, toListSchema, toSearchSchema } from '@zmdb/schema-core/openapi';

export const UserSchema = defineSchema('users', {
  id: serial().primaryKey(),
  email: text().notNull(),
  role: jsonEnum(['admin', 'user']).notNull().defaultTo('user'),
  age: integer().nullable().validate(tags.Minimum(0)),
});

export const ProductSchema = defineSchema('products', {
  id: serial().primaryKey(),
  name: text().notNull().validate(tags.MinLength(1)).validate(tags.MaxLength(100)),
  price: numeric().notNull().validate(tags.Minimum(0)),
  code: text().notNull().validate(tags.Pattern('^[A-Z]{3}$')),
  status: jsonEnum(['active', 'inactive']).notNull(),
});

export const ProfileSchema = defineSchema('profiles', {
  id: serial().primaryKey(),
  avatar: text().notNull(),
  bio: text().nullable(),
});

export const OrderSchema = defineSchema('orders', {
  id: serial().primaryKey(),
  userId: references(integer().notNull(), 'users.id'),
  total: numeric().notNull().validate(tags.Minimum(0)),
});

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
