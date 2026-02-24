/**
 * Real Redis utilities for Docker-based testing
 *
 * Uses actual Redis connections (no mocks) for integration testing.
 * Designed to run inside Docker containers with access to Redis via Docker DNS.
 */

import Redis from "ioredis";

/**
 * Test Redis configuration from environment variables
 */
export const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests to avoid conflicts with other data
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    if (times > 3) return null;
    return Math.min(times * 100, 1000);
  },
};

/**
 * Create a new real Redis connection for testing
 */
export function createTestRedis(): Redis {
  return new Redis(TEST_REDIS_CONFIG);
}

/**
 * Flush the test database (DB 15)
 */
export async function flushTestDatabase(redis: Redis): Promise<void> {
  await redis.flushdb();
}

/**
 * Close Redis connection gracefully
 */
export async function closeTestRedis(redis: Redis): Promise<void> {
  await redis.quit();
}

/**
 * Wait for Redis to be ready (useful in Docker startup)
 */
export async function waitForRedis(
  redis: Redis,
  timeoutMs = 30000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      await redis.ping();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw new Error(`Redis did not become available within ${timeoutMs}ms`);
}

/**
 * Get all keys matching a pattern (for test assertions)
 */
export async function getTestRedisKeys(
  redis: Redis,
  pattern = "*"
): Promise<string[]> {
  return redis.keys(pattern);
}

/**
 * Dump all Redis data for debugging
 */
export async function dumpTestRedisData(
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
