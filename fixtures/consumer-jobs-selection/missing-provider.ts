import { createQueue, type Clock } from '@zmdb/jobs';

const clock: Clock = {
  now: () => 0,
  sleep: () => Promise.resolve(),
};

// This fixture is compiled expecting a diagnostic. Portable jobs imports, but
// constructing a queue requires an explicitly selected provider's JobStore.
createQueue({ clock });
