import { describe, it, expect } from 'vitest';

import { mysqlDialect, postgresDialect, sqliteDialect } from '../testing/official-dialects.fixture.js';
import { aggregateSelectFrom } from './index.js';

// RED PHASE (#89 spec freeze): aggregate / GROUP BY / HAVING golden SQL.

describe('aggregate compilation (postgres golden)', () => {
  it('COUNT + GROUP BY + ORDER BY + pagination', () => {
    const q = aggregateSelectFrom('orders', postgresDialect)
      .select(['orders.id'])
      .count('order_details.product_id', 'products_count')
      .groupBy('orders.id')
      .orderBy('orders.id', 'asc')
      .limit(50)
      .offset(0)
      .compile();
    expect(q.text).toBe(
      'SELECT "orders"."id", COUNT("order_details"."product_id") AS "products_count" FROM "orders" GROUP BY "orders"."id" ORDER BY "orders"."id" ASC LIMIT 50 OFFSET 0',
    );
  });

  it('SUM + HAVING (parameterized)', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .sum('quantity', 'qty')
      .having('quantity', '>', 0)
      .groupBy('order_id')
      .compile();
    expect(q.text).toBe(
      'SELECT SUM("quantity") AS "qty" FROM "order_details" GROUP BY "order_id" HAVING "quantity" > $1',
    );
    expect(q.parameters).toEqual([0]);
  });

  it('count, sum, avg, min and max each project one aggregate with its alias', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .select(['order_id'])
      .count('id', 'lines')
      .sum('quantity', 'qty')
      .avg('unit_price', 'avg_price')
      .min('unit_price', 'cheapest')
      .max('unit_price', 'dearest')
      .groupBy('order_id')
      .compile();
    expect(q.text).toBe(
      'SELECT "order_id", COUNT("id") AS "lines", SUM("quantity") AS "qty", AVG("unit_price") AS "avg_price", ' +
        'MIN("unit_price") AS "cheapest", MAX("unit_price") AS "dearest" FROM "order_details" GROUP BY "order_id"',
    );
    expect(q.parameters).toEqual([]);
  });

  it('groupBy + having + orderBy + pagination compose in the right order', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .select(['order_id'])
      .sum('quantity', 'qty')
      .groupBy('order_id')
      .having('order_id', '>', 10)
      .orderBy('order_id', 'desc')
      .limit(20)
      .offset(40)
      .compile();
    expect(q.text).toBe(
      'SELECT "order_id", SUM("quantity") AS "qty" FROM "order_details" GROUP BY "order_id" ' +
        'HAVING "order_id" > $1 ORDER BY "order_id" DESC LIMIT 20 OFFSET 40',
    );
    expect(q.parameters).toEqual([10]);
  });

  it('multiple HAVING predicates are AND-joined and parameterized', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .sum('quantity', 'qty')
      .groupBy('order_id')
      .having('quantity', '>', 0)
      .having('unit_price', '<', 100)
      .compile();
    expect(q.text).toBe(
      'SELECT SUM("quantity") AS "qty" FROM "order_details" GROUP BY "order_id" ' +
        'HAVING "quantity" > $1 AND "unit_price" < $2',
    );
    expect(q.parameters).toEqual([0, 100]);
  });

  it('groups by multiple columns', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .select(['order_id', 'product_id'])
      .count('id', 'n')
      .groupBy('order_id')
      .groupBy('product_id')
      .compile();
    expect(q.text).toBe(
      'SELECT "order_id", "product_id", COUNT("id") AS "n" FROM "order_details" GROUP BY "order_id", "product_id"',
    );
  });

  it('expr() emits a sanitized computed expression with alias and quoted column identifiers', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .expr('sum(quantity * unit_price)::real', 'total')
      .groupBy('order_id')
      .compile();
    expect(q.text).toContain('sum("quantity" * "unit_price")::real AS "total"');
  });

  it('quotes dot-qualified column identifiers in raw expressions', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .expr('sum(order_details.quantity * order_details.unit_price)', 'total')
      .groupBy('order_id')
      .compile();
    expect(q.text).toContain('sum("order_details"."quantity" * "order_details"."unit_price") AS "total"');
  });

  it('extracts positional parameter placeholders (?) into query bindings', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .expr('sum(quantity * ?) * ?', 'discounted_total', [0.9, 100])
      .groupBy('order_id')
      .compile();
    expect(q.text).toContain('sum("quantity" * $1) * $2 AS "discounted_total"');
    expect(q.parameters).toEqual([0.9, 100]);
  });

  it('extracts named parameter placeholders (:name) into query bindings', () => {
    const q = aggregateSelectFrom('order_details', postgresDialect)
      .expr('sum(quantity * :multiplier) + :offset', 'adjusted_total', { multiplier: 1.5, offset: 50 })
      .groupBy('order_id')
      .compile();
    expect(q.text).toContain('sum("quantity" * $1) + $2 AS "adjusted_total"');
    expect(q.parameters).toEqual([1.5, 50]);
  });

  it('extracts numeric and string literals in raw expressions into positional parameter bindings', () => {
    const q = aggregateSelectFrom('products', postgresDialect)
      .expr("CASE WHEN status = 'active' THEN price * 1.1 ELSE price END", 'discounted_price')
      .compile();
    expect(q.text).toContain('CASE WHEN "status" = $1 THEN "price" * $2 ELSE "price" END AS "discounted_price"');
    expect(q.parameters).toEqual(['active', 1.1]);
  });

  it('neutralizes injected SQL payloads by binding them strictly as scalar parameters', () => {
    const maliciousInput = '1; DROP TABLE users; --';
    const q = aggregateSelectFrom('orders', postgresDialect).expr('title = ?', 'matched', [maliciousInput]).compile();
    expect(q.text).toBe('SELECT "title" = $1 AS "matched" FROM "orders"');
    expect(q.parameters).toEqual(['1; DROP TABLE users; --']);
  });

  it('supports dialect-aware column identifier escaping for MySQL and SQLite', () => {
    const qMysql = aggregateSelectFrom('order_details', mysqlDialect)
      .expr('sum(quantity * unit_price)', 'total', [1.0])
      .compile();
    expect(qMysql.text).toContain('sum(`quantity` * `unit_price`) AS `total`');

    const qSqlite = aggregateSelectFrom('order_details', sqliteDialect)
      .expr('sum(quantity * unit_price)', 'total')
      .compile();
    expect(qSqlite.text).toContain('sum("quantity" * "unit_price") AS "total"');
  });
});

describe('aggregate compile-time telemetry', () => {
  it('keeps telemetry absent from the default compiled query', () => {
    const q = aggregateSelectFrom('orders', postgresDialect).count('id', 'count').compile();
    expect(Object.keys(q)).toEqual(['text', 'parameters']);
    expect(q.telemetry).toBeUndefined();
  });

  it('attaches the compile-known SELECT and primary table when opted in', () => {
    const q = aggregateSelectFrom('orders', postgresDialect, { telemetry: true }).count('id', 'count').compile();
    expect(q.telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'orders',
    });
  });
});
