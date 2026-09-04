> **ToDo / partial support.** The public custom-transport contract ships and is
> usable today, and Redis, NATS and RabbitMQ demonstrate that contract. gRPC and
> the final supported-page pass remain pending.

## Implementing the public contract

Use only the public microservices and observability entry points:

```ts
import type { TraceCarrier } from '@zmdb/web/observability';
import type {
  DispatchOutcome,
  MessageReply,
  RawMessage,
  TransportRequest,
  TransportStrategy,
} from '@zmdb/web/microservices';

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

The undefined `wire` helpers above are the broker-specific part: framing,
authentication, subscription tokens, reply destinations and connection
draining. The framework owns declaration lookup, payload validation, handler
invocation, retry policy and typed client validation.

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

If framing or JSON parsing fails, do not invent a normal payload. Preserve the
raw input in `payload` and set `parseError`; the dispatcher then reports it to
`onInvalidPayload` and returns a `dead` settlement.

Apply the returned settlement while the broker delivery token is still in
scope:

- `ack` completes the delivery;
- `retry` schedules redelivery after `afterMs`;
- `dead` moves the delivery to the dead-letter destination.

There is deliberately no immediate `requeue` option. A deterministic failure
returned to the head of a queue creates a tight poison-message loop.

For a request delivery, publish `outcome.reply` only to the transport-owned
reply destination. The dispatcher supplies a generic error reply on handler
failure; it does not leak the thrown error.

## Outbound requests

`TransportRequest` already contains a generated correlation id, timeout and
`AbortSignal`. Preserve the id in the returned `MessageReply`, and release all
waiters and subscriptions when the signal aborts.

The higher-level client still races the required deadline. That protects the
caller even if a custom strategy mishandles cancellation, while the signal lets
a correct strategy stop network work rather than leave it running in the
background.

Do not accept a caller-supplied correlation id. Two callers choosing the same
id can resolve each other's replies.

## Capabilities are enforced

Declare only behavior the strategy can actually implement:

```ts
readonly capabilities = {
  redelivery: false,
  deadLetter: false,
  requestResponse: false,
};
```

With either delivery capability absent, `createApp` requires an
`onUndeliverable` sink. With request/reply absent, `createMessageClient` rejects
before calling `send`.

## Application-owned lifecycle

Attach the strategy when creating the application:

```ts
await using app = createApp(AppModule, {
  transports: [new AcmeTransport()],
  dispatcher: {
    onUnhandled,
    onInvalidPayload,
    onHandlerError,
    onUndeliverable,
  },
  graceMs: 5_000,
});

await app.init();
```

The app calls `listen` after bootstrap hooks. On disposal it calls
`close(graceMs)` before provider/controller shutdown hooks. A strategy is not
`AsyncDisposable`: that method has no grace argument and cannot express the
application's bounded drain.

## Stability boundary

A third-party strategy may rely on:

- `TransportStrategy`, `TransportCapabilities` and `TransportRequest`;
- `RawMessage`, `Settlement`, `MessageReply` and `DispatchOutcome`;
- the public client error classes.

Do not depend on dispatcher internals or construct `MessageContext` yourself.
Within a major release, required strategy members and settlement arms are
stable. Optional diagnostic data may be added to `RawMessage`.

Test a custom strategy for parse failure, all three settlements, correlated
success and error replies, cancellation, concurrent out-of-order replies,
partial application startup and bounded reverse shutdown.

---

See also: [Broker Transports](./web-microservices-transports.html) · [Hybrid Applications](./web-hybrid-application.html) · [Microservices](./web-microservices.html)
