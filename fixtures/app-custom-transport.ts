import {
  MessageCorrelationError,
  MessageRemoteError,
  MessageTimeoutError,
  TransportUnsupportedError,
  type DispatchOutcome,
  type MessageReply,
  type RawMessage,
  type Settlement,
  type TransportCapabilities,
  type TransportRequest,
  type TransportStrategy,
} from '@zmdb/app/messaging';
import type { TraceCarrier } from '@zmdb/app/observability';

type Dispatch = (message: RawMessage) => Promise<DispatchOutcome>;

const CAPABILITIES: TransportCapabilities = {
  redelivery: true,
  deadLetter: true,
  requestResponse: true,
};

/**
 * Consumer-owned strategy used from outside `packages/app`.
 *
 * It imports only published entry points. `verify:publish` copies this file
 * beside the packed packages and compiles it there, where a private relative
 * import cannot accidentally work.
 */
export class PublicCustomTransport implements TransportStrategy {
  readonly name = 'public-custom';
  readonly capabilities = CAPABILITIES;
  readonly log: string[];

  readonly #inFlight = new Set<Promise<DispatchOutcome>>();
  #accepting = false;
  #connectionOpen = false;
  #dispatch: Dispatch | undefined;

  constructor(log: string[] = []) {
    this.log = log;
  }

  get accepting(): boolean {
    return this.#accepting;
  }

  get connectionOpen(): boolean {
    return this.#connectionOpen;
  }

  listen(dispatch: Dispatch): Promise<void> {
    if (this.#connectionOpen) {
      return Promise.reject(new Error('public custom transport is already listening'));
    }
    this.#dispatch = dispatch;
    this.#accepting = true;
    this.#connectionOpen = true;
    this.log.push('listen:public-custom');
    return Promise.resolve();
  }

  deliver(message: RawMessage): Promise<DispatchOutcome> {
    const dispatch = this.#dispatch;
    if (!this.#accepting || dispatch === undefined) {
      return Promise.reject(new Error('public custom transport is not accepting deliveries'));
    }

    let task: Promise<DispatchOutcome>;
    task = dispatch(message).finally(() => {
      this.#inFlight.delete(task);
    });
    this.#inFlight.add(task);
    return task;
  }

  send(request: TransportRequest): Promise<MessageReply> {
    return Promise.resolve({
      kind: 'result',
      correlationId: request.correlationId,
      payload: request.payload,
    });
  }

  emit(_pattern: string, _payload: unknown, _carrier?: TraceCarrier): Promise<void> {
    return Promise.resolve();
  }

  async close(graceMs: number): Promise<void> {
    if (!this.#connectionOpen) {
      return;
    }
    if (!Number.isInteger(graceMs) || graceMs < 0) {
      throw new RangeError('public custom transport graceMs must be a non-negative integer');
    }

    this.#accepting = false;
    this.log.push(`stop:intake:${String(graceMs)}`);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const drained = await Promise.race([
      Promise.all(this.#inFlight).then(() => true),
      new Promise<false>(resolve => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    this.#dispatch = undefined;
    this.#connectionOpen = false;
    this.log.push('close:connection');
    if (!drained) {
      throw new Error(`public custom transport did not drain within ${String(graceMs)}ms`);
    }
  }
}

/** Every public error class named by the custom-transport stability contract. */
export const PUBLIC_CLIENT_ERRORS = [
  MessageCorrelationError,
  MessageRemoteError,
  MessageTimeoutError,
  TransportUnsupportedError,
] as const;

/** Keeps the settlement union itself on the external consumer's checked surface. */
export function settlementKind(settlement: Settlement): Settlement['kind'] {
  return settlement.kind;
}
