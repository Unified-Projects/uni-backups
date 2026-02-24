import Redis from "ioredis";

let redisClient: Redis | null = null;
let subscriberClient: Redis | null = null;

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  keyPrefix?: string;
}

export function getRedisConfig(): RedisConfig {
  return {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379", 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB || "0", 10),
    keyPrefix: process.env.REDIS_KEY_PREFIX || "uni-backups:",
  };
}

export function createRedisConnection(config?: Partial<RedisConfig>): Redis {
  const finalConfig = { ...getRedisConfig(), ...config };

  const redis = new Redis({
    host: finalConfig.host,
    port: finalConfig.port,
    password: finalConfig.password,
    db: finalConfig.db,
    keyPrefix: finalConfig.keyPrefix,
    retryStrategy: (times) => Math.min(times * 100, 30000),
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  redis.on("error", (err) => {
    console.error("[Redis] Connection error:", err.message);
  });

  redis.on("connect", () => {
    console.log(`[Redis] Connected to ${finalConfig.host}:${finalConfig.port}`);
  });

  redis.on("reconnecting", () => {
    console.log("[Redis] Reconnecting...");
  });

  return redis;
}

export function getRedisConnection(): Redis {
  if (!redisClient) {
    redisClient = createRedisConnection();
  }
  return redisClient;
}

export function getRedisSubscriber(): Redis {
  if (!subscriberClient) {
    subscriberClient = createRedisConnection();
  }
  return subscriberClient;
}

// BullMQ doesn't support keyPrefix
export function getBullMQConnection(): Redis {
  const config = getRedisConfig();

  return new Redis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    maxRetriesPerRequest: null, // required for BullMQ
    enableReadyCheck: false, // required for BullMQ
  });
}

export async function closeRedisConnections(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (redisClient) {
    promises.push(
      redisClient.quit().then(() => {
        redisClient = null;
      })
    );
  }

  if (subscriberClient) {
    promises.push(
      subscriberClient.quit().then(() => {
        subscriberClient = null;
      })
    );
  }

  await Promise.all(promises);
  console.log("[Redis] All connections closed");
}

export async function checkRedisHealth(): Promise<boolean> {
  try {
    const redis = getRedisConnection();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
