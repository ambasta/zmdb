// zmdb/entity-modeling — explicit named re-exports.
export { EventBus } from '@zmdb/orm/entity-modeling';
export { discriminatorFor, flattenEmbeddable, liftEmbeddable, rowToSubtype } from '@zmdb/schema/entity-modeling';
export type { LifecycleEvent, Subscriber } from '@zmdb/orm/entity-modeling';
export type { SingleTableInheritance } from '@zmdb/schema/entity-modeling';
