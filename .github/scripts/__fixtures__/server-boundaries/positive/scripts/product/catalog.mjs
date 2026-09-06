const row = (id, npmName) =>
  Object.freeze({
    id,
    directory: `packages/${id}`,
    npmName,
  });

export const PRODUCT_CATALOG = Object.freeze([
  row('app', '@zmdb/app'),
  row('jobs', '@zmdb/jobs'),
  row('jobs-postgres', '@zmdb/jobs-postgres'),
  row('otel', '@zmdb/otel'),
  row('protobuf', '@zmdb/protobuf'),
  row('transport-grpc', '@zmdb/transport-grpc'),
  row('transport-nats', '@zmdb/transport-nats'),
  row('transport-rabbitmq', '@zmdb/transport-rabbitmq'),
  row('transport-redis', '@zmdb/transport-redis'),
  row('web', '@zmdb/web'),
  row('zmdb', 'zmdb'),
]);
