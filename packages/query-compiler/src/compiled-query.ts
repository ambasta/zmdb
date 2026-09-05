export interface CompiledQuery {
  readonly text: string;
  readonly parameters: readonly unknown[];
  readonly telemetry?: QueryTelemetry;
}

/** Compile-time database attributes consumed by tracing and metrics. */
export interface QueryTelemetry {
  readonly system: string;
  readonly operation: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
  readonly collection: string;
}
