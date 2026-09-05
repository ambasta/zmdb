import type { Meter, Tracer } from '@opentelemetry/api';
import type { Observability } from '@zmdb/app/observability';

import type { OpenTelemetryOptions, fromOpenTelemetry } from './index.js';

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2 ? true : false;
type Expect<Value extends true> = Value;

export type _OptionKeys = Expect<Equal<keyof OpenTelemetryOptions, 'meter' | 'tracer'>>;
export type _TracerOption = Expect<Equal<OpenTelemetryOptions['tracer'], Tracer | undefined>>;
export type _MeterOption = Expect<Equal<OpenTelemetryOptions['meter'], Meter | undefined>>;
export type _EmptyConfiguration = Expect<{} extends OpenTelemetryOptions ? true : false>;
export type _TracerOnlyConfiguration = Expect<{ readonly tracer: Tracer } extends OpenTelemetryOptions ? true : false>;
export type _MeterOnlyConfiguration = Expect<{ readonly meter: Meter } extends OpenTelemetryOptions ? true : false>;
export type _AdapterParameter = Expect<Equal<Parameters<typeof fromOpenTelemetry>, [OpenTelemetryOptions]>>;
export type _AdapterReturn = Expect<Equal<ReturnType<typeof fromOpenTelemetry>, Observability>>;
