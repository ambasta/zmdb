import { metrics, trace } from '@opentelemetry/api';
import { fromOpenTelemetry, type OpenTelemetryOptions } from '@zmdb/app/otel';

const options: OpenTelemetryOptions = {
  tracer: trace.getTracer('@zmdb-fixture/server-otel'),
  meter: metrics.getMeter('@zmdb-fixture/server-otel'),
};
const adapter: typeof fromOpenTelemetry = fromOpenTelemetry;
const observability = adapter(options);

void observability;
