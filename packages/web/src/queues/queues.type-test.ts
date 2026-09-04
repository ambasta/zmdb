// Compile-time half of #587. The queue module is not present yet, so the frozen surface is local.
// #588 replaces these declarations with imports; the assertions remain unchanged.
type Backoff =
  | { readonly kind: 'fixed'; readonly delayMs: number }
  | { readonly kind: 'exponential'; readonly baseMs: number; readonly ceilingMs: number };

interface JobContext {
  readonly attempt: number;
}

interface JobHandler<M, K extends keyof M & string> {
  readonly name: K;
  readonly validate: (raw: unknown) => M[K];
  handle(payload: M[K], ctx: JobContext): Promise<void>;
}

type AnyJobHandler<M> = { readonly [K in keyof M & string]: JobHandler<M, K> }[keyof M & string];

interface Queue<M> {
  enqueue<K extends keyof M & string>(
    name: K,
    payload: M[K],
    options?: { readonly delayMs?: number; readonly dedupeKey?: string },
  ): Promise<string>;
}

type Jobs = {
  readonly 'post.notify': { readonly postId: string };
  readonly 'user.audit': { readonly userId: number };
};

declare const queue: Queue<Jobs>;

export const notify: AnyJobHandler<Jobs> = {
  name: 'post.notify',
  validate: () => ({ postId: 'p1' }),
  handle: () => Promise.resolve(),
};

// The broad form accepts this mismatch, which is why AnyJobHandler is mapped by key.
export const broadAcceptsMismatch: readonly JobHandler<Jobs, keyof Jobs & string>[] = [
  {
    name: 'post.notify',
    validate: () => ({ userId: 1 }),
    handle: () => Promise.resolve(),
  },
];

// @ts-expect-error - the name and payload must come from the same row of Jobs.
export const mappedRejectsMismatch: AnyJobHandler<Jobs> = {
  name: 'post.notify',
  validate: () => ({ userId: 1 }),
  handle: () => Promise.resolve(),
};

void queue.enqueue('post.notify', { postId: 'p1' });
// @ts-expect-error - user.audit's payload cannot be sent to post.notify.
void queue.enqueue('post.notify', { userId: 1 });
// @ts-expect-error - an unknown job name is not a key of Jobs.
void queue.enqueue('missing', { postId: 'p1' });

export const fixed: Backoff = { kind: 'fixed', delayMs: 1000 };
// @ts-expect-error - ceilingMs exists only on exponential backoff.
export const fixedWithCeiling: Backoff = { kind: 'fixed', delayMs: 1000, ceilingMs: 5000 };
