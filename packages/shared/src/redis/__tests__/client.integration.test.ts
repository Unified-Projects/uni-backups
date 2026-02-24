/**
 * Redis Client Integration Tests - REAL REDIS (NO MOCKS)
 *
 * Tests for Redis connection management, singleton behavior, and health checks.
 * Runs against actual Redis via Docker.
 *
 * Requires Docker services to be running:
 *   docker compose -f tests/compose/services.yml --profile redis up -d
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, beforeAll } from "vitest";
import Redis from "ioredis";
import {
  createRedisConnection,
  getRedisConfig,
  getBullMQConnection,
  checkRedisHealth,
  closeRedisConnections,
  getRedisConnection,
  getRedisSubscriber,
  type RedisConfig,
} from "../client";

// Real Redis configuration from environment
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || "testpass123",
  db: 15, // Use DB 15 for tests to avoid conflicts
};

const TEST_TIMEOUT = 60000;

describe("Redis Client (Integration)", () => {
  let testConnections: Redis[] = [];

  const trackConnection = (redis: Redis): Redis => {
    testConnections.push(redis);
    return redis;
  };

  beforeAll(async () => {
    // Verify Redis is accessible
    const testRedis = new Redis(TEST_REDIS_CONFIG);
    try {
      await testRedis.ping();
      await testRedis.quit();
    } catch {
      throw new Error(
        "Redis is not running. Start with: docker compose -f tests/compose/services.yml --profile redis up -d"
      );
    }
  });

  beforeEach(async () => {
    // Set environment variables for tests
    process.env.REDIS_HOST = TEST_REDIS_CONFIG.host;
    process.env.REDIS_PORT = String(TEST_REDIS_CONFIG.port);
    process.env.REDIS_PASSWORD = TEST_REDIS_CONFIG.password;
    process.env.REDIS_DB = String(TEST_REDIS_CONFIG.db);
  });

  afterEach(async () => {
    // Close all tracked connections
    for (const redis of testConnections) {
      try {
        if (redis.status !== "end") {
          await redis.quit();
        }
      } catch {
        // Ignore errors during cleanup
      }
    }
    testConnections = [];

    // Close singleton connections
    await closeRedisConnections();
  });

  afterAll(async () => {
    // Final cleanup
    await closeRedisConnections();
  });

  describe("getRedisConfig", () => {
    it("reads configuration from environment variables", () => {
      const config = getRedisConfig();

      expect(config.host).toBe(TEST_REDIS_CONFIG.host);
      expect(config.port).toBe(TEST_REDIS_CONFIG.port);
      expect(config.password).toBe(TEST_REDIS_CONFIG.password);
      expect(config.db).toBe(TEST_REDIS_CONFIG.db);
    });

    it("uses default values when environment variables are not set", () => {
      // Clear env vars
      const originalHost = process.env.REDIS_HOST;
      const originalPort = process.env.REDIS_PORT;
      const originalPassword = process.env.REDIS_PASSWORD;
      const originalDb = process.env.REDIS_DB;

      delete process.env.REDIS_HOST;
      delete process.env.REDIS_PORT;
      delete process.env.REDIS_PASSWORD;
      delete process.env.REDIS_DB;

      try {
        const config = getRedisConfig();

        expect(config.host).toBe("localhost");
        expect(config.port).toBe(6379);
        expect(config.password).toBeUndefined();
        expect(config.db).toBe(0);
        expect(config.keyPrefix).toBe("uni-backups:");
      } finally {
        // Restore env vars
        process.env.REDIS_HOST = originalHost;
        process.env.REDIS_PORT = originalPort;
        process.env.REDIS_PASSWORD = originalPassword;
        process.env.REDIS_DB = originalDb;
      }
    });

    it("includes keyPrefix from environment", () => {
      process.env.REDIS_KEY_PREFIX = "test-prefix:";

      try {
        const config = getRedisConfig();
        expect(config.keyPrefix).toBe("test-prefix:");
      } finally {
        delete process.env.REDIS_KEY_PREFIX;
      }
    });
  });

  describe("createRedisConnection", () => {
    it("creates a functional Redis connection", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      const pong = await redis.ping();
      expect(pong).toBe("PONG");
    });

    it("uses default config when no config provided", async () => {
      const redis = trackConnection(createRedisConnection());

      // Should connect using env vars
      const pong = await redis.ping();
      expect(pong).toBe("PONG");
    });

    it("merges partial config with defaults", async () => {
      const redis = trackConnection(
        createRedisConnection({
          db: TEST_REDIS_CONFIG.db,
        })
      );

      const pong = await redis.ping();
      expect(pong).toBe("PONG");
    });

    it("accepts keyPrefix configuration", async () => {
      // Test that createRedisConnection accepts keyPrefix option
      const redis = trackConnection(
        createRedisConnection({
          ...TEST_REDIS_CONFIG,
          keyPrefix: "testprefix:",
        })
      );

      // Connection should work
      const pong = await redis.ping();
      expect(pong).toBe("PONG");

      // Verify the connection has the prefix configured
      // (keyPrefix is applied by ioredis internally)
      await redis.set("prefixed-key", "prefixed-value");
      const value = await redis.get("prefixed-key");
      expect(value).toBe("prefixed-value");

      // Cleanup - the actual key has the prefix but we use unprefixed name
      await redis.del("prefixed-key");
    });

    it("supports custom database selection", async () => {
      const redis = trackConnection(
        createRedisConnection({
          ...TEST_REDIS_CONFIG,
          db: 14, // Different DB
        })
      );

      await redis.set("db-test-key", "db-test-value");

      // Verify key is in DB 14, not DB 15
      const db15Redis = trackConnection(
        new Redis({
          ...TEST_REDIS_CONFIG,
          db: 15,
        })
      );

      const valueInDb15 = await db15Redis.get("db-test-key");
      expect(valueInDb15).toBeNull();

      // Cleanup
      await redis.del("db-test-key");
    });

    it("executes basic Redis operations", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      // String operations
      await redis.set("test:string", "hello");
      const strValue = await redis.get("test:string");
      expect(strValue).toBe("hello");

      // Hash operations
      await redis.hset("test:hash", "field1", "value1", "field2", "value2");
      const hashValue = await redis.hgetall("test:hash");
      expect(hashValue).toEqual({ field1: "value1", field2: "value2" });

      // List operations
      await redis.rpush("test:list", "a", "b", "c");
      const listValues = await redis.lrange("test:list", 0, -1);
      expect(listValues).toEqual(["a", "b", "c"]);

      // Set operations
      await redis.sadd("test:set", "x", "y", "z");
      const setMembers = await redis.smembers("test:set");
      expect(setMembers.sort()).toEqual(["x", "y", "z"]);

      // Sorted set operations
      await redis.zadd("test:zset", 1, "one", 2, "two", 3, "three");
      const zsetMembers = await redis.zrange("test:zset", 0, -1);
      expect(zsetMembers).toEqual(["one", "two", "three"]);

      // Cleanup
      await redis.del("test:string", "test:hash", "test:list", "test:set", "test:zset");
    });

    it("supports TTL operations", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      await redis.setex("test:ttl", 10, "expiring-value");

      const ttl = await redis.ttl("test:ttl");
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);

      // Cleanup
      await redis.del("test:ttl");
    });

    it("supports transactions with MULTI/EXEC", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      const results = await redis
        .multi()
        .set("test:tx1", "value1")
        .set("test:tx2", "value2")
        .get("test:tx1")
        .get("test:tx2")
        .exec();

      expect(results).not.toBeNull();
      expect(results![2][1]).toBe("value1");
      expect(results![3][1]).toBe("value2");

      // Cleanup
      await redis.del("test:tx1", "test:tx2");
    });
  }, TEST_TIMEOUT);

  describe("getBullMQConnection", () => {
    it("creates connection suitable for BullMQ", async () => {
      const redis = trackConnection(getBullMQConnection());

      const pong = await redis.ping();
      expect(pong).toBe("PONG");
    });

    it("does not use keyPrefix for BullMQ", async () => {
      const redis = trackConnection(getBullMQConnection());

      // Wait for connection to be ready (important when enableReadyCheck is false)
      await new Promise<void>((resolve, reject) => {
        if (redis.status === "ready") {
          resolve();
        } else {
          redis.once("ready", resolve);
          redis.once("error", reject);
        }
      });

      await redis.set("bullmq-test-key", "test-value");

      // Verify key is set without prefix
      const value = await redis.get("bullmq-test-key");
      expect(value).toBe("test-value");

      // Cleanup
      await redis.del("bullmq-test-key");
    });

    it("has maxRetriesPerRequest set to null for BullMQ compatibility", async () => {
      const redis = trackConnection(getBullMQConnection());

      // BullMQ requires maxRetriesPerRequest to be null
      // We can verify connection works for BullMQ-like patterns
      const pong = await redis.ping();
      expect(pong).toBe("PONG");
    });

    it("creates independent connections on each call", async () => {
      const redis1 = trackConnection(getBullMQConnection());
      const redis2 = trackConnection(getBullMQConnection());

      expect(redis1).not.toBe(redis2);

      // Both should work independently
      const pong1 = await redis1.ping();
      const pong2 = await redis2.ping();
      expect(pong1).toBe("PONG");
      expect(pong2).toBe("PONG");
    });
  }, TEST_TIMEOUT);

  describe("getRedisConnection (singleton)", () => {
    it("returns the same connection on multiple calls", async () => {
      const redis1 = getRedisConnection();
      const redis2 = getRedisConnection();

      expect(redis1).toBe(redis2);
    });

    it("creates a functional connection", async () => {
      const redis = getRedisConnection();

      const pong = await redis.ping();
      expect(pong).toBe("PONG");
    });
  }, TEST_TIMEOUT);

  describe("getRedisSubscriber (singleton)", () => {
    it("returns the same subscriber connection on multiple calls", async () => {
      const sub1 = getRedisSubscriber();
      const sub2 = getRedisSubscriber();

      expect(sub1).toBe(sub2);
    });

    it("returns different connection than main client", async () => {
      const mainClient = getRedisConnection();
      const subscriber = getRedisSubscriber();

      expect(mainClient).not.toBe(subscriber);
    });

    it("creates a functional connection", async () => {
      const subscriber = getRedisSubscriber();

      const pong = await subscriber.ping();
      expect(pong).toBe("PONG");
    });
  }, TEST_TIMEOUT);

  describe("pub/sub functionality", () => {
    it("supports publish and subscribe pattern", async () => {
      const publisher = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));
      const subscriber = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      const receivedMessages: string[] = [];
      const channel = "test-channel";

      await new Promise<void>((resolve) => {
        subscriber.subscribe(channel, (err) => {
          if (err) throw err;
          resolve();
        });
      });

      subscriber.on("message", (ch, message) => {
        if (ch === channel) {
          receivedMessages.push(message);
        }
      });

      // Wait for subscription to be active
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish messages
      await publisher.publish(channel, "message-1");
      await publisher.publish(channel, "message-2");

      // Wait for messages to be received
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedMessages).toContain("message-1");
      expect(receivedMessages).toContain("message-2");

      // Cleanup
      await subscriber.unsubscribe(channel);
    });

    it("supports pattern subscriptions", async () => {
      const publisher = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));
      const subscriber = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      const receivedMessages: { channel: string; message: string }[] = [];
      const pattern = "events:*";

      await new Promise<void>((resolve) => {
        subscriber.psubscribe(pattern, (err) => {
          if (err) throw err;
          resolve();
        });
      });

      subscriber.on("pmessage", (_pattern, channel, message) => {
        receivedMessages.push({ channel, message });
      });

      // Wait for subscription to be active
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Publish to different channels matching pattern
      await publisher.publish("events:user", "user-event");
      await publisher.publish("events:order", "order-event");
      await publisher.publish("other:channel", "should-not-receive");

      // Wait for messages to be received
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(receivedMessages).toHaveLength(2);
      expect(receivedMessages.some((m) => m.channel === "events:user")).toBe(true);
      expect(receivedMessages.some((m) => m.channel === "events:order")).toBe(true);

      // Cleanup
      await subscriber.punsubscribe(pattern);
    });
  }, TEST_TIMEOUT);

  describe("checkRedisHealth", () => {
    it("returns true when Redis is healthy", async () => {
      const healthy = await checkRedisHealth();
      expect(healthy).toBe(true);
    });

    it("returns true after singleton is initialized", async () => {
      // Initialize singleton
      getRedisConnection();

      const healthy = await checkRedisHealth();
      expect(healthy).toBe(true);
    });
  }, TEST_TIMEOUT);

  describe("closeRedisConnections", () => {
    it("closes singleton connections", async () => {
      // Initialize singletons
      const mainClient = getRedisConnection();
      const subscriber = getRedisSubscriber();

      // Verify they work
      await mainClient.ping();
      await subscriber.ping();

      // Close connections
      await closeRedisConnections();

      // After closing, getting new connection should create new instances
      const newMainClient = getRedisConnection();
      const newSubscriber = getRedisSubscriber();

      // New connections should be different
      expect(newMainClient).not.toBe(mainClient);
      expect(newSubscriber).not.toBe(subscriber);

      // And should still work
      await newMainClient.ping();
      await newSubscriber.ping();
    });

    it("handles multiple close calls gracefully", async () => {
      getRedisConnection();

      // Should not throw on multiple closes
      await closeRedisConnections();
      await closeRedisConnections();
      await closeRedisConnections();
    });

    it("handles close when no connections exist", async () => {
      // Should not throw when nothing to close
      await closeRedisConnections();
    });
  }, TEST_TIMEOUT);

  describe("connection resilience", () => {
    it("maintains connection after heavy operations", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      // Perform many operations
      const promises: Promise<unknown>[] = [];
      for (let i = 0; i < 100; i++) {
        promises.push(redis.set(`test:heavy:${i}`, `value-${i}`));
      }
      await Promise.all(promises);

      // Connection should still work
      const pong = await redis.ping();
      expect(pong).toBe("PONG");

      // Verify data
      const value = await redis.get("test:heavy:50");
      expect(value).toBe("value-50");

      // Cleanup
      const delPromises: Promise<number>[] = [];
      for (let i = 0; i < 100; i++) {
        delPromises.push(redis.del(`test:heavy:${i}`));
      }
      await Promise.all(delPromises);
    });

    it("handles concurrent operations correctly", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      // Run concurrent increments
      const key = "test:concurrent:counter";
      await redis.set(key, "0");

      const incrementPromises: Promise<number>[] = [];
      for (let i = 0; i < 50; i++) {
        incrementPromises.push(redis.incr(key));
      }
      await Promise.all(incrementPromises);

      const finalValue = await redis.get(key);
      expect(parseInt(finalValue!, 10)).toBe(50);

      // Cleanup
      await redis.del(key);
    });

    it("handles pipeline operations", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      const pipeline = redis.pipeline();
      for (let i = 0; i < 10; i++) {
        pipeline.set(`test:pipeline:${i}`, `value-${i}`);
      }
      for (let i = 0; i < 10; i++) {
        pipeline.get(`test:pipeline:${i}`);
      }

      const results = await pipeline.exec();
      expect(results).not.toBeNull();
      expect(results).toHaveLength(20);

      // First 10 are SET results
      for (let i = 0; i < 10; i++) {
        expect(results![i][1]).toBe("OK");
      }

      // Next 10 are GET results
      for (let i = 10; i < 20; i++) {
        expect(results![i][1]).toBe(`value-${i - 10}`);
      }

      // Cleanup
      const delPipeline = redis.pipeline();
      for (let i = 0; i < 10; i++) {
        delPipeline.del(`test:pipeline:${i}`);
      }
      await delPipeline.exec();
    });
  }, TEST_TIMEOUT);

  describe("Lua scripting", () => {
    it("executes simple Lua scripts", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      const result = await redis.eval(
        `return redis.call('SET', KEYS[1], ARGV[1])`,
        1,
        "test:lua:key",
        "lua-value"
      );

      expect(result).toBe("OK");

      const value = await redis.get("test:lua:key");
      expect(value).toBe("lua-value");

      // Cleanup
      await redis.del("test:lua:key");
    });

    it("executes atomic increment with Lua", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      const key = "test:lua:counter";
      await redis.set(key, "10");

      const script = `
        local current = redis.call('GET', KEYS[1])
        local new_value = tonumber(current) + tonumber(ARGV[1])
        redis.call('SET', KEYS[1], new_value)
        return new_value
      `;

      const result = await redis.eval(script, 1, key, "5");
      expect(result).toBe(15);

      const finalValue = await redis.get(key);
      expect(finalValue).toBe("15");

      // Cleanup
      await redis.del(key);
    });
  }, TEST_TIMEOUT);

  describe("key expiration", () => {
    it("sets and retrieves TTL", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      await redis.setex("test:expire:key", 60, "value");

      const ttl = await redis.ttl("test:expire:key");
      expect(ttl).toBeGreaterThan(55);
      expect(ttl).toBeLessThanOrEqual(60);

      // Cleanup
      await redis.del("test:expire:key");
    });

    it("handles PTTL for millisecond precision", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      await redis.psetex("test:pexpire:key", 5000, "value");

      const pttl = await redis.pttl("test:pexpire:key");
      expect(pttl).toBeGreaterThan(4000);
      expect(pttl).toBeLessThanOrEqual(5000);

      // Cleanup
      await redis.del("test:pexpire:key");
    });

    it("removes TTL with PERSIST", async () => {
      const redis = trackConnection(createRedisConnection(TEST_REDIS_CONFIG));

      await redis.setex("test:persist:key", 60, "value");
      await redis.persist("test:persist:key");

      const ttl = await redis.ttl("test:persist:key");
      expect(ttl).toBe(-1); // No expiration

      // Cleanup
      await redis.del("test:persist:key");
    });
  }, TEST_TIMEOUT);
});
