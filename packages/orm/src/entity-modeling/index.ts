// Entity modeling: lifecycle events — see ./SPEC.md.

// §1 lifecycle events
export type LifecycleEvent =
  | 'beforeCreate'
  | 'afterCreate'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeDelete'
  | 'afterDelete';

export interface Subscriber {
  on: LifecycleEvent;
  run: (ctx: unknown) => void | Promise<void>;
}

/**
 * Sequential entity-lifecycle subscribers for repository write hooks.
 *
 * A failure intentionally stops the remaining subscribers and rejects the
 * write, so this is not the application-event emitter. Use `createEvents` from
 * `@zmdb/app/events` when handlers must run concurrently with isolated errors.
 */
export class EventBus {
  private subs: Subscriber[] = [];
  subscribe(s: Subscriber): () => void {
    this.subs.push(s);
    return () => {
      const i = this.subs.indexOf(s);
      if (i >= 0) this.subs.splice(i, 1);
    };
  }
  async emit(event: LifecycleEvent, ctx: unknown): Promise<void> {
    for (const s of this.subs) {
      if (s.on === event) await s.run(ctx);
    }
  }
}
