import { BasicTracerProvider, InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';

const { fromOpenTelemetry } = await import('@zmdb/otel');
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

try {
  const observability = fromOpenTelemetry({ tracer: provider.getTracer('@zmdb-fixture/server-otel') });
  const span = observability.tracer?.startSpan('installed consumer');
  span?.end();
  await provider.forceFlush();
  if (exporter.getFinishedSpans().length !== 1) {
    throw new Error('@zmdb/otel did not export the installed consumer span');
  }
  console.log('@zmdb/otel packed consumer: real API and SDK span export executed');
} finally {
  await provider.shutdown();
}
