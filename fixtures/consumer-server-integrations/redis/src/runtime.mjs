const redis = await import('@zmdb/transport-redis');

if (typeof redis.createRedisStrategy !== 'function') {
  throw new Error('@zmdb/transport-redis omitted createRedisStrategy');
}
