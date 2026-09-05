const nats = await import('@zmdb/transport-nats');

if (typeof nats.createNatsStrategy !== 'function') {
  throw new Error('@zmdb/transport-nats omitted createNatsStrategy');
}
