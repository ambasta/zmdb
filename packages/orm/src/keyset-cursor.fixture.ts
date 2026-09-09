import { schemasFrom } from '@zmdb/compiler/testing';
import { type PrimaryKey, type Serial, type Sql, type Table } from '@zmdb/schema/tags';

export interface Product extends Table<'products'> {
  id: number & Sql<'integer'> & Serial & PrimaryKey;
  name: string & Sql<'text'>;
  age: number & Sql<'integer'>;
  category: string & Sql<'text'>;
}

export interface TenantProduct extends Table<'tenant_products'> {
  tenantId: string & Sql<'text'> & PrimaryKey;
  productId: number & Sql<'integer'> & PrimaryKey;
  rank: number & Sql<'integer'>;
}

export const { Product: ProductSchema, TenantProduct: TenantProductSchema } = schemasFrom<{
  Product: Product;
  TenantProduct: TenantProduct;
}>(import.meta.url, ['Product', 'TenantProduct']);
