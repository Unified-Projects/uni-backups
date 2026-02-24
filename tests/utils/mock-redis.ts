/**
 * Mock Redis utilities for testing
 *
 * Uses ioredis-mock to provide an in-memory Redis implementation.
 */

import Redis from "ioredis-mock";

/**
 * Create a new mock Redis instance
 */
export function createMockRedis(): Redis {
  return new Redis();
}

/**
 * Create a mock Redis that simulates a specific state
 */
export async function createMockRedisWithData(
  data: Record<string, Record<string, string> | string[] | string>
): Promise<Redis> {
  const redis = new Redis();

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") {
      await redis.set(key, value);
    } else if (Array.isArray(value)) {
      if (value.length > 0) {
        await redis.rpush(key, ...value);
      }
    } else if (typeof value === "object") {
      await redis.hset(key, value);
    }
  }

  return redis;
}

/**
 * Wait for Redis operations to complete (for async consistency in tests)
 */
export async function flushRedisOperations(redis: Redis): Promise<void> {
  // ioredis-mock operations are synchronous but wrapped in promises
  // This ensures any pending operations are flushed
  await redis.ping();
}

/**
 * Clear all data in mock Redis
 */
export async function clearMockRedis(redis: Redis): Promise<void> {
  await redis.flushall();
}

/**
 * Get all keys matching a pattern (for test assertions)
 */
export async function getMockRedisKeys(
  redis: Redis,
  pattern = "*"
): Promise<string[]> {
  return redis.keys(pattern);
}

/**
 * Dump all Redis data for debugging
 */
export async function dumpMockRedisData(
  redis: Redis
): Promise<Record<string, unknown>> {
  const keys = await redis.keys("*");
  const data: Record<string, unknown> = {};

  for (const key of keys) {
    const type = await redis.type(key);

    switch (type) {
      case "string":
        data[key] = await redis.get(key);
        break;
      case "hash":
        data[key] = await redis.hgetall(key);
        break;
      case "list":
        data[key] = await redis.lrange(key, 0, -1);
        break;
      case "set":
        data[key] = await redis.smembers(key);
        break;
      case "zset":
        data[key] = await redis.zrange(key, 0, -1, "WITHSCORES");
        break;
      default:
        data[key] = `<unknown type: ${type}>`;
    }
  }

  return data;
}

export { Redis };
