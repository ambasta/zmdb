const rabbitmq = await import('@zmdb/transport-rabbitmq');

if (typeof rabbitmq.createRabbitMqStrategy !== 'function') {
  throw new Error('@zmdb/transport-rabbitmq omitted createRabbitMqStrategy');
}
