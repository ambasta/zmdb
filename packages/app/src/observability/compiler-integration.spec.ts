import { tracedDriver, type Span, type SpanContext, type Tracer } from '@zmdb/app/observability';
import { postgres } from '@zmdb/postgres';
import { createQueryCompiler } from '@zmdb/query-compiler';
import { describe, expect, it } from 'vitest';

const context: SpanContext = {
  traceId: '00000000000000000000000000000001',
  spanId: '0000000000000001',
  traceFlags: 1,
};

const tracer: Tracer = {
  startSpan: () => {
    const span: Span = {
      updateName: () => undefined,
      setAttribute: () => undefined,
      recordException: () => undefined,
      setStatus: () => undefined,
      end: () => undefined,
      spanContext: () => context,
    };
    return span;
  },
};

describe('app observability compiler integration', () => {
  it('marks configured drivers so callers can opt the compiler into telemetry', async () => {
    const queries: Parameters<ReturnType<typeof tracedDriver>['execute']>[0][] = [];
    const driver = tracedDriver(
      {
        dialect: postgres,
        execute: query => {
          queries.push(query);
          return Promise.resolve([]);
        },
      },
      { tracer },
    );

    expect(driver.queryTelemetry).toBe(true);
    const compiler = createQueryCompiler(postgres, driver.queryTelemetry === true ? { telemetry: true } : {});
    await driver.execute(compiler.selectFrom('users').compile());
    expect(queries[0]?.telemetry).toEqual({
      system: 'postgresql',
      operation: 'SELECT',
      collection: 'users',
    });
  });
});
