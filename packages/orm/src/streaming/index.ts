/**
 * Add repository ergonomics around a driver's deliberately small stream
 * surface. The driver owns its cursor; this wrapper owns single-shot use,
 * per-row mapping, and exactly one cleanup path.
 */
export function createRepositoryStream<Raw, Row>(
  open: () => AsyncIterable<Raw>,
  map: (row: Raw) => Row,
  signal?: AbortSignal,
): AsyncIterable<Row> & AsyncDisposable {
  let started = false;
  let disposed = false;
  let active: AsyncIterator<Raw> | undefined;
  let closing: Promise<void> | undefined;

  const close = (): Promise<void> => {
    if (closing !== undefined) return closing;
    disposed = true;
    const iterator = active;
    active = undefined;
    closing = (async () => {
      if (iterator?.return !== undefined) await iterator.return();
    })();
    return closing;
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<Row> {
      if (started) throw new Error('repository stream is single-shot');
      if (disposed) throw new Error('repository stream has been disposed');
      started = true;

      const iterate = async function* (): AsyncGenerator<Row, void, unknown> {
        let completed = false;
        try {
          if (disposed) throw new Error('repository stream has been disposed');
          signal?.throwIfAborted();
          active = open()[Symbol.asyncIterator]();

          for (;;) {
            signal?.throwIfAborted();
            const iterator = active;
            if (iterator === undefined) return;
            const next = await iterator.next();
            if (disposed) return;
            signal?.throwIfAborted();
            if (next.done) {
              completed = true;
              active = undefined;
              disposed = true;
              return;
            }
            yield map(next.value);
          }
        } finally {
          if (!completed) await close();
        }
      };

      return iterate();
    },

    [Symbol.asyncDispose](): Promise<void> {
      return close();
    },
  };
}
