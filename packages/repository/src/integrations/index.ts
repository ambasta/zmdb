// Framework-agnostic endpoint adapter — see ./SPEC.md.

export interface Handler<In, Out> {
  validate: (raw: unknown) => In;
  handle: (input: In) => Promise<Out>;
  serialize?: (out: Out) => string;
}

export interface EndpointResult {
  status: number;
  body: string;
}

export function makeEndpoint<In, Out>(_h: Handler<In, Out>): (raw: unknown) => Promise<EndpointResult> {
  throw new Error('not implemented');
}
