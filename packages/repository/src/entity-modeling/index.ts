// Entity modeling: lifecycle events, embeddables, inheritance — see ./SPEC.md.

// §1 lifecycle events
export type LifecycleEvent =
  | 'beforeCreate' | 'afterCreate'
  | 'beforeUpdate' | 'afterUpdate'
  | 'beforeDelete' | 'afterDelete';

export interface Subscriber {
  on: LifecycleEvent;
  run: (ctx: unknown) => void | Promise<void>;
}

export class EventBus {
  private subs: Subscriber[] = [];
  subscribe(_s: Subscriber): () => void {
    throw new Error('not implemented');
  }
  async emit(_event: LifecycleEvent, _ctx: unknown): Promise<void> {
    throw new Error('not implemented');
  }
}

// §2 embeddables
export function flattenEmbeddable(_prefix: string, _value: Record<string, unknown>): Record<string, unknown> {
  throw new Error('not implemented');
}
export function liftEmbeddable(_prefix: string, _row: Record<string, unknown>): Record<string, unknown> {
  throw new Error('not implemented');
}

// §3 inheritance
export interface SingleTableInheritance {
  discriminator: string;
  map: Record<string, readonly string[]>;
}
export function discriminatorFor(_sti: SingleTableInheritance, _type: string): string {
  throw new Error('not implemented');
}
export function rowToSubtype(
  _sti: SingleTableInheritance,
  _row: Record<string, unknown>,
): { type: string; data: Record<string, unknown> } {
  throw new Error('not implemented');
}
