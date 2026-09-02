// The component name for a table: singularize each word, then PascalCase.
//
// This used to declare twenty one-column schemas whose only distinguishing feature was
// the table name, because `pascalCase` was private and `toOpenApiComponents` was the only
// door to it. The subject was always a string function, so it is tested as one now, and
// the two schema-level tests at the bottom are the ones that are genuinely about a
// document — that the key a component is filed under and the `$ref` that points at it are
// the same string.

import { schemasFrom } from '@zmdb/aot-validator/testing';
import { describe, expect, it } from 'vitest';

import { manyToOne, oneToMany } from '../relations/index.ts';
import type { PrimaryKey, Serial, Sql, Table } from '../tags/index.ts';
import { componentName, toJsonSchemaWithRelations, toOpenApiComponents } from './index.ts';

describe('componentName', () => {
  it('leaves a word that only looks plural alone', () => {
    // The `ss`/`us`/`is`/`as`/`os` endings, plus the words that end in `s` singular.
    expect(['address', 'process', 'status', 'lens', 'series', 'species', 'news'].map(componentName)).toEqual([
      'Address',
      'Process',
      'Status',
      'Lens',
      'Series',
      'Species',
      'News',
    ]);
  });

  it('singularizes the -sses family, which the generic -s rule gets wrong', () => {
    expect(['addresses', 'processes', 'statuses', 'aliases'].map(componentName)).toEqual([
      'Address',
      'Process',
      'Status',
      'Alias',
    ]);
  });

  it('singularizes the standard suffixes', () => {
    expect(['categories', 'boxes', 'churches', 'dishes', 'shelves', 'users'].map(componentName)).toEqual([
      'Category',
      'Box',
      'Church',
      'Dish',
      'Shelf',
      'User',
    ]);
  });

  it('handles the irregulars and the -ves spellings', () => {
    expect(['knives', 'wives', 'leaves', 'matrices', 'indices', 'people', 'children'].map(componentName)).toEqual([
      'Knife',
      'Wife',
      'Leaf',
      'Matrix',
      'Index',
      'Person',
      'Child',
    ]);
  });

  it('trims a plain trailing -s, and only that', () => {
    expect(['houses', 'cases', 'orders', 'box', 'category'].map(componentName)).toEqual([
      'House',
      'Case',
      'Order',
      'Box',
      'Category',
    ]);
  });

  it('singularizes every word of a snake_case name', () => {
    // Not just the last one: `user_addresses` is `UserAddress`, and a name whose *first*
    // word is plural is singularized too.
    expect(['user_addresses', 'order_statuses', 'product_categories', 'orders_items'].map(componentName)).toEqual([
      'UserAddress',
      'OrderStatus',
      'ProductCategory',
      'OrderItem',
    ]);
  });
});

export interface UserAddress extends Table<'user_addresses'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  orderId: number & Sql<'integer'>;
}

export interface OrderStatus extends Table<'order_statuses'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  categoryId: number & Sql<'integer'>;
}

export interface Category extends Table<'categories'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
}

const {
  UserAddress: addresses,
  OrderStatus: statuses,
  Category: categories,
} = schemasFrom(import.meta.url, ['UserAddress', 'OrderStatus', 'Category']);

describe('a $ref and the key it points at', () => {
  it('files each component under its singularized name', () => {
    const components = toOpenApiComponents([addresses, statuses, categories]);
    expect(Object.keys(components.schemas)).toEqual(['Category', 'OrderStatus', 'UserAddress']);
  });

  it('points a relation at a key the document actually has', () => {
    // The claim worth a test: the two call sites of `componentName` agree. A `$ref` to a
    // component that does not exist is a document that fails validation downstream, and
    // nothing in either function alone would catch a disagreement.
    const components = toOpenApiComponents([addresses, statuses, categories]);
    const withRelations = toJsonSchemaWithRelations(
      statuses,
      {
        category: manyToOne('categories', 'categoryId'),
        addresses: oneToMany('user_addresses', 'orderId'),
      },
      'entity',
    );

    expect(withRelations.properties.category).toEqual({ $ref: '#/components/schemas/Category' });
    expect(withRelations.properties.addresses).toEqual({
      type: 'array',
      items: { $ref: '#/components/schemas/UserAddress' },
    });
    expect(components.schemas).toHaveProperty('Category');
    expect(components.schemas).toHaveProperty('UserAddress');
  });
});
