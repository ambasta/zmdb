import { describe, it, expect } from 'vitest';

import type { CoreSchema } from '../index.ts';
import { manyToOne, oneToMany } from '../relations/index.ts';
import { toOpenApiComponents, toJsonSchemaWithRelations } from './index.ts';

function createDummySchema<T extends string>(table: T): CoreSchema<T> {
  return {
    table,
    columns: {
      id: { type: 'serial', flags: { nullable: false, primaryKey: true, autoIncrement: true, hasDefault: true } },
    },
    primaryKey: ['id'],
    references: [],
  } as unknown as CoreSchema<T>;
}

describe('OpenAPI schema singularization', () => {
  it('preserves double "s" ending words in singular form', () => {
    const addressSchema = createDummySchema('address');
    const processSchema = createDummySchema('process');
    const components = toOpenApiComponents([addressSchema, processSchema]);

    expect(Object.keys(components.schemas)).toEqual(['Address', 'Process']);
  });

  it('singularizes plural table names ending in "esses"', () => {
    const addressesSchema = createDummySchema('addresses');
    const processesSchema = createDummySchema('processes');
    const components = toOpenApiComponents([addressesSchema, processesSchema]);

    expect(Object.keys(components.schemas)).toEqual(['Address', 'Process']);
  });

  it('singularizes standard plural suffixes correctly', () => {
    const categoriesSchema = createDummySchema('categories');
    const statusesSchema = createDummySchema('statuses');
    const boxesSchema = createDummySchema('boxes');
    const churchesSchema = createDummySchema('churches');
    const dishesSchema = createDummySchema('dishes');
    const shelvesSchema = createDummySchema('shelves');

    const components = toOpenApiComponents([
      categoriesSchema,
      statusesSchema,
      boxesSchema,
      churchesSchema,
      dishesSchema,
      shelvesSchema,
    ]);

    expect(Object.keys(components.schemas)).toEqual(['Box', 'Category', 'Church', 'Dish', 'Shelf', 'Status']);
  });

  it('preserves already singular table names', () => {
    const statusSchema = createDummySchema('status');
    const categorySchema = createDummySchema('category');
    const boxSchema = createDummySchema('box');
    const userSchema = createDummySchema('user');

    const components = toOpenApiComponents([statusSchema, categorySchema, boxSchema, userSchema]);

    expect(Object.keys(components.schemas)).toEqual(['Box', 'Category', 'Status', 'User']);
  });

  it('handles snake_case compound table names', () => {
    const userAddressesSchema = createDummySchema('user_addresses');
    const orderStatusesSchema = createDummySchema('order_statuses');
    const productCategoriesSchema = createDummySchema('product_categories');

    const components = toOpenApiComponents([userAddressesSchema, orderStatusesSchema, productCategoriesSchema]);

    expect(Object.keys(components.schemas)).toEqual(['OrderStatus', 'ProductCategory', 'UserAddress']);
  });

  it('correctly handles edge cases like houses, cases, knives, wives, and lens', () => {
    const housesSchema = createDummySchema('houses');
    const casesSchema = createDummySchema('cases');
    const knivesSchema = createDummySchema('knives');
    const wivesSchema = createDummySchema('wives');
    const lensSchema = createDummySchema('lens');

    const components = toOpenApiComponents([housesSchema, casesSchema, knivesSchema, wivesSchema, lensSchema]);

    expect(Object.keys(components.schemas)).toEqual(['Case', 'House', 'Knife', 'Lens', 'Wife']);
  });

  it('ensures relation $ref target pointers match singularized component schema keys', () => {
    const userAddressesSchema = createDummySchema('user_addresses');
    const orderStatusesSchema = createDummySchema('order_statuses');
    const categoriesSchema = createDummySchema('categories');

    const components = toOpenApiComponents([userAddressesSchema, orderStatusesSchema, categoriesSchema]);

    const orderRel = toJsonSchemaWithRelations(
      orderStatusesSchema,
      {
        category: manyToOne('categories', 'categoryId'),
        addresses: oneToMany('user_addresses', 'orderId'),
      },
      'entity',
    );

    expect(orderRel.properties.category).toEqual({
      $ref: '#/components/schemas/Category',
    });
    expect(orderRel.properties.addresses).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/UserAddress' },
    });

    // Check that $ref targets exist as keys in component schemas
    expect(components.schemas).toHaveProperty('Category');
    expect(components.schemas).toHaveProperty('UserAddress');
  });
});
