The public custom-transport contract is exercised from outside `packages/app` by `fixtures/app-custom-transport.ts`. The publish gate compiles that fixture against packed packages, and the runtime
suite proves dispatch, stopped intake, bounded drain and connection close through the same public surface shown here.

Custom transports implement `TransportStrategy` from `@zmdb/app/messaging`; there is no web transport subpath or required broker peer. The application owns the strategy through `transportExtension`,
while the implementation owns its protocol connection and must stop intake, drain accepted dispatches, and close within the supplied grace budget.

## Implementing the public contract

Use only the public microservices and observability entry points:

```ts
import type { TraceCarrier } from '@zmdb/app/observability';
import type { DispatchOutcome, MessageReply, RawMessage, TransportRequest, TransportStrategy } from '@zmdb/app/messaging';

type Dispatch = (message: RawMessage) => Promise<DispatchOutcome>;

export class AcmeTransport implements TransportStrategy {
  readonly name = 'acme';
  readonly capabilities = {
    redelivery: true,
    deadLetter: true,
    requestResponse: true,
  };

  #dispatch: Dispatch | undefined;

  async listen(dispatch: Dispatch): Promise<void> {
    this.#dispatch = dispatch;
    await wire.subscribe(async frame => {
      const delivery = decodeDelivery(frame);
      const outcome = await dispatch(delivery.message);
      await wire.applySettlement(delivery.token, outcome.settlement);
      if (outcome.reply !== undefined && delivery.replyTo !== undefined) {
        await wire.publishReply(delivery.replyTo, outcome.reply);
      }
    });
  }

  async send(request: TransportRequest): Promise<MessageReply> {
    return wire.request(
      {
        pattern: request.pattern,
        payload: request.payload,
        correlationId: request.correlationId,
      },
      { signal: request.signal, timeoutMs: request.timeoutMs },
    );
  }

  async emit(pattern: string, payload: unknown, carrier?: TraceCarrier): Promise<void> {
    await wire.publish({ pattern, payload, ...carrier });
  }

  async close(graceMs: number): Promise<void> {
    this.#dispatch = undefined;
    await wire.stopAndDrain(graceMs);
  }
}
```

The undefined `wire` helpers above are the broker-specific part: framing, authentication, subscription tokens, reply destinations and connection draining. As in the tested fixture, `stopAndDrain` must
stop intake first, track every dispatch already accepted, wait no longer than `graceMs`, close the connection even when the bound expires, and reject so shutdown cannot report a clean drain. The
framework owns declaration lookup, payload validation, handler invocation, retry policy and typed client validation.

`@zmdb/app/messaging` also exports the broker-free adapter kit used by the packaged strategies: versioned JSON `encodeDelivery`/`decodeDelivery` and reply codecs, `InFlight`, `reportTransportError`,
`withinGrace`, and `abortError`. A custom protocol may use those helpers without importing web or a broker client.

## Inbound deliveries

Decode the broker envelope before constructing `RawMessage`:

```ts
const message: RawMessage = {
  pattern: envelope.pattern,
  payload: envelope.payload,
  headers: envelope.headers,
  correlationId: envelope.correlationId,
  replyTo: envelope.replyTo,
  deliveryAttempt: envelope.deliveryAttempt,
};
```

If framing or JSON parsing fails, do not invent a normal payload. Preserve the raw input in `payload` and set `parseError`; the dispatcher then reports it to `onInvalidPayload` and returns a `dead`
settlement.

Apply the returned settlement while the broker delivery token is still in scope:

- `ack` completes the delivery;
- `retry` schedules redelivery after `afterMs`;
- `dead` moves the delivery to the dead-letter destination.

There is deliberately no immediate `requeue` option. A deterministic failure returned to the head of a queue creates a tight poison-message loop.

For a request delivery, publish `outcome.reply` only to the transport-owned reply destination. The dispatcher supplies a generic error reply on handler failure; it does not leak the thrown error.

## Outbound requests

`TransportRequest` already contains a generated correlation id, timeout and `AbortSignal`. Preserve the id in the returned `MessageReply`, and release all waiters and subscriptions when the signal
aborts.

The higher-level client still races the required deadline. That protects the caller even if a custom strategy mishandles cancellation, while the signal lets a correct strategy stop network work rather
than leave it running in the background.

Do not accept a caller-supplied correlation id. Two callers choosing the same id can resolve each other's replies.

## Capabilities are enforced

Declare only behavior the strategy can actually implement:

```ts
readonly capabilities = {
  redelivery: false,
  deadLetter: false,
  requestResponse: false,
};
```

With either delivery capability absent, `transportExtension` requires an `onUndeliverable` sink. With request/reply absent, `createMessageClient` rejects before calling `send`.

## Application-owned lifecycle

Attach the strategy when creating the application:

```ts
import { transportExtension } from '@zmdb/app/messaging';

await using app = createApp(AppModule, {
  extensions: [
    transportExtension({
      transports: [new AcmeTransport()],
      dispatcher: {
        onUnhandled,
        onInvalidPayload,
        onHandlerError,
        onUndeliverable,
      },
    }),
  ],
  graceMs: 5_000,
});

await app.init();
```

The app calls `listen` after bootstrap hooks. On disposal it calls `close(graceMs)` before provider/controller shutdown hooks. A strategy is not `AsyncDisposable`: that method has no grace argument
and cannot express the application's bounded drain.

## Stability boundary

A third-party strategy may rely on:

- `TransportStrategy`, `TransportCapabilities` and `TransportRequest`;
- `RawMessage`, `Settlement`, `MessageReply` and `DispatchOutcome`;
- the public client error classes.

Do not depend on dispatcher internals or construct `MessageContext` yourself. Within a major release, required strategy members and settlement arms are stable. Optional diagnostic data may be added to
`RawMessage`.

Test a custom strategy for parse failure, all three settlements, correlated success and error replies, cancellation, concurrent out-of-order replies, partial application startup and bounded reverse
shutdown.

---

See also: [Broker Transports](./web-microservices-transports.html) · [Hybrid Applications](./web-hybrid-application.html) · [Microservices](./web-microservices.html)
