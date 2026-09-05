// zmdb/entity-modeling — explicit named re-exports.
export {
  EventBus,
  discriminatorFor,
  flattenEmbeddable,
  liftEmbeddable,
  rowToSubtype,
} from '@zmdb/repository/entity-modeling';
export type { LifecycleEvent, SingleTableInheritance, Subscriber } from '@zmdb/repository/entity-modeling';
