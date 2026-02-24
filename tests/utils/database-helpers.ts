/**
 * Database Test Helpers
 *
 * Utilities for seeding, dumping, and verifying database content
 * in integration tests. Uses real database connections - no mocking.
 */

import { Client as PostgresClient } from "pg";
import { createConnection, Connection as MariaDBConnection, RowDataPacket } from "mysql2/promise";
import Redis from "ioredis";
import {
  TEST_CONFIG,
  createTestPostgres,
  createTestPostgresRestore,
  createTestMariaDB,
  createTestMariaDBRestore,
  createTestRedis,
} from "./test-services";

export interface PostgresTestData {
  tables: string[];
  rowCounts: Record<string, number>;
  checksums: Record<string, string>;
}

/**
 * Seed PostgreSQL test database with sample data
 */
export async function seedPostgres(client?: PostgresClient): Promise<PostgresTestData> {
  const conn = client || await createTestPostgres();
  const shouldClose = !client;

  try {
    // Create test tables
    await conn.query(`
      DROP TABLE IF EXISTS test_orders CASCADE;
      DROP TABLE IF EXISTS test_users CASCADE;
      DROP TABLE IF EXISTS test_products CASCADE;
    `);

    await conn.query(`
      CREATE TABLE test_users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await conn.query(`
      CREATE TABLE test_products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        stock INTEGER DEFAULT 0
      )
    `);

    await conn.query(`
      CREATE TABLE test_orders (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES test_users(id),
        product_id INTEGER REFERENCES test_products(id),
        quantity INTEGER NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert test data
    await conn.query(`
      INSERT INTO test_users (name, email) VALUES
        ('Alice Johnson', 'alice@test.com'),
        ('Bob Smith', 'bob@test.com'),
        ('Carol Williams', 'carol@test.com'),
        ('David Brown', 'david@test.com'),
        ('Eve Davis', 'eve@test.com')
    `);

    await conn.query(`
      INSERT INTO test_products (name, price, stock) VALUES
        ('Widget A', 29.99, 100),
        ('Widget B', 49.99, 50),
        ('Gadget X', 99.99, 25),
        ('Gadget Y', 149.99, 10),
        ('Super Device', 299.99, 5)
    `);

    await conn.query(`
      INSERT INTO test_orders (user_id, product_id, quantity, total, status) VALUES
        (1, 1, 2, 59.98, 'completed'),
        (1, 3, 1, 99.99, 'completed'),
        (2, 2, 3, 149.97, 'pending'),
        (3, 4, 1, 149.99, 'shipped'),
        (4, 5, 1, 299.99, 'completed'),
        (5, 1, 5, 149.95, 'pending'),
        (2, 3, 2, 199.98, 'completed'),
        (3, 2, 1, 49.99, 'cancelled')
    `);

    // Get metadata
    const tables = ["test_users", "test_products", "test_orders"];
    const rowCounts: Record<string, number> = {};
    const checksums: Record<string, string> = {};

    for (const table of tables) {
      const countResult = await conn.query(`SELECT COUNT(*) as count FROM ${table}`);
      rowCounts[table] = parseInt((countResult.rows[0] as { count: string }).count, 10);

      // Create a simple checksum of sorted data
      const dataResult = await conn.query(`SELECT * FROM ${table} ORDER BY id`);
      checksums[table] = createDataChecksum(dataResult.rows);
    }

    return { tables, rowCounts, checksums };
  } finally {
    if (shouldClose) {
      await conn.end();
    }
  }
}

/**
 * Verify PostgreSQL restore by comparing data
 */
export async function verifyPostgresRestore(
  sourceClient: PostgresClient,
  restoreClient: PostgresClient,
  tables: string[]
): Promise<{ match: boolean; differences: string[] }> {
  const differences: string[] = [];

  for (const table of tables) {
    // Check if table exists in restore
    const tableCheck = await restoreClient.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = $1
      )
    `, [table]);

    if (!(tableCheck.rows[0] as { exists: boolean }).exists) {
      differences.push(`Table ${table} does not exist in restore`);
      continue;
    }

    // Compare row counts
    const sourceCount = await sourceClient.query(`SELECT COUNT(*) as count FROM ${table}`);
    const restoreCount = await restoreClient.query(`SELECT COUNT(*) as count FROM ${table}`);

    const sourceN = parseInt((sourceCount.rows[0] as { count: string }).count, 10);
    const restoreN = parseInt((restoreCount.rows[0] as { count: string }).count, 10);

    if (sourceN !== restoreN) {
      differences.push(`Table ${table}: row count mismatch (source: ${sourceN}, restore: ${restoreN})`);
    }

    // Compare data checksums
    const sourceData = await sourceClient.query(`SELECT * FROM ${table} ORDER BY id`);
    const restoreData = await restoreClient.query(`SELECT * FROM ${table} ORDER BY id`);

    const sourceChecksum = createDataChecksum(sourceData.rows);
    const restoreChecksum = createDataChecksum(restoreData.rows);

    if (sourceChecksum !== restoreChecksum) {
      differences.push(`Table ${table}: data checksum mismatch`);
    }
  }

  return { match: differences.length === 0, differences };
}

/**
 * Clear PostgreSQL test tables
 */
export async function clearPostgresTables(client: PostgresClient, tables: string[]): Promise<void> {
  for (const table of tables.reverse()) {
    await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
  }
}

/**
 * Execute a SQL file on PostgreSQL (for restore testing)
 */
export async function executeSqlFile(client: PostgresClient, sql: string): Promise<void> {
  await client.query(sql);
}

export interface MariaDBTestData {
  tables: string[];
  rowCounts: Record<string, number>;
  checksums: Record<string, string>;
}

/**
 * Seed MariaDB test database with sample data
 */
export async function seedMariaDB(conn?: MariaDBConnection): Promise<MariaDBTestData> {
  const connection = conn || await createTestMariaDB();
  const shouldClose = !conn;

  try {
    // Create test tables
    await connection.query(`DROP TABLE IF EXISTS test_orders`);
    await connection.query(`DROP TABLE IF EXISTS test_users`);
    await connection.query(`DROP TABLE IF EXISTS test_products`);

    await connection.query(`
      CREATE TABLE test_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE test_products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        stock INT DEFAULT 0
      )
    `);

    await connection.query(`
      CREATE TABLE test_orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        product_id INT,
        quantity INT NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES test_users(id),
        FOREIGN KEY (product_id) REFERENCES test_products(id)
      )
    `);

    // Insert test data
    await connection.query(`
      INSERT INTO test_users (name, email) VALUES
        ('Alice Johnson', 'alice@test.com'),
        ('Bob Smith', 'bob@test.com'),
        ('Carol Williams', 'carol@test.com'),
        ('David Brown', 'david@test.com'),
        ('Eve Davis', 'eve@test.com')
    `);

    await connection.query(`
      INSERT INTO test_products (name, price, stock) VALUES
        ('Widget A', 29.99, 100),
        ('Widget B', 49.99, 50),
        ('Gadget X', 99.99, 25),
        ('Gadget Y', 149.99, 10),
        ('Super Device', 299.99, 5)
    `);

    await connection.query(`
      INSERT INTO test_orders (user_id, product_id, quantity, total, status) VALUES
        (1, 1, 2, 59.98, 'completed'),
        (1, 3, 1, 99.99, 'completed'),
        (2, 2, 3, 149.97, 'pending'),
        (3, 4, 1, 149.99, 'shipped'),
        (4, 5, 1, 299.99, 'completed'),
        (5, 1, 5, 149.95, 'pending'),
        (2, 3, 2, 199.98, 'completed'),
        (3, 2, 1, 49.99, 'cancelled')
    `);

    // Get metadata
    const tables = ["test_users", "test_products", "test_orders"];
    const rowCounts: Record<string, number> = {};
    const checksums: Record<string, string> = {};

    for (const table of tables) {
      const [countResult] = await connection.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM ${table}`);
      rowCounts[table] = countResult[0].count as number;

      // Create a simple checksum
      const [dataResult] = await connection.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY id`);
      checksums[table] = createDataChecksum(dataResult);
    }

    return { tables, rowCounts, checksums };
  } finally {
    if (shouldClose) {
      await connection.end();
    }
  }
}

/**
 * Verify MariaDB restore by comparing data
 */
export async function verifyMariaDBRestore(
  sourceConn: MariaDBConnection,
  restoreConn: MariaDBConnection,
  tables: string[]
): Promise<{ match: boolean; differences: string[] }> {
  const differences: string[] = [];

  for (const table of tables) {
    // Check if table exists
    try {
      await restoreConn.query(`SELECT 1 FROM ${table} LIMIT 1`);
    } catch {
      differences.push(`Table ${table} does not exist in restore`);
      continue;
    }

    // Compare row counts
    const [sourceCount] = await sourceConn.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM ${table}`);
    const [restoreCount] = await restoreConn.query<RowDataPacket[]>(`SELECT COUNT(*) as count FROM ${table}`);

    if (sourceCount[0].count !== restoreCount[0].count) {
      differences.push(`Table ${table}: row count mismatch (source: ${sourceCount[0].count}, restore: ${restoreCount[0].count})`);
    }

    // Compare data checksums
    const [sourceData] = await sourceConn.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY id`);
    const [restoreData] = await restoreConn.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY id`);

    const sourceChecksum = createDataChecksum(sourceData);
    const restoreChecksum = createDataChecksum(restoreData);

    if (sourceChecksum !== restoreChecksum) {
      differences.push(`Table ${table}: data checksum mismatch`);
    }
  }

  return { match: differences.length === 0, differences };
}

/**
 * Clear MariaDB test tables
 */
export async function clearMariaDBTables(conn: MariaDBConnection, tables: string[]): Promise<void> {
  await conn.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const table of tables) {
    await conn.query(`DROP TABLE IF EXISTS ${table}`);
  }
  await conn.query("SET FOREIGN_KEY_CHECKS = 1");
}

export interface RedisTestData {
  keys: string[];
  keyTypes: Record<string, string>;
  checksums: Record<string, string>;
}

/**
 * Seed Redis with test data
 */
export async function seedRedis(redis?: Redis): Promise<RedisTestData> {
  const conn = redis || createTestRedis();
  const shouldClose = !redis;
  const prefix = "test:";

  try {
    // Clear existing test keys
    const existingKeys = await conn.keys(`${prefix}*`);
    if (existingKeys.length > 0) {
      await conn.del(...existingKeys);
    }

    // String keys
    await conn.set(`${prefix}string:simple`, "Hello World");
    await conn.set(`${prefix}string:number`, "42");
    await conn.set(`${prefix}string:json`, JSON.stringify({ nested: { data: true } }));
    await conn.set(`${prefix}string:binary`, Buffer.from([0x00, 0x01, 0xff]).toString("binary"));

    // Hash keys
    await conn.hset(`${prefix}hash:user`, {
      name: "Test User",
      email: "test@example.com",
      age: "30",
    });
    await conn.hset(`${prefix}hash:config`, {
      setting1: "value1",
      setting2: "value2",
      enabled: "true",
    });

    // List keys
    await conn.rpush(`${prefix}list:items`, "item1", "item2", "item3", "item4", "item5");
    await conn.rpush(`${prefix}list:queue`, "job1", "job2", "job3");

    // Set keys
    await conn.sadd(`${prefix}set:tags`, "tag1", "tag2", "tag3");
    await conn.sadd(`${prefix}set:ids`, "1", "2", "3", "4", "5");

    // Sorted set keys
    await conn.zadd(`${prefix}zset:scores`, 100, "alice", 95, "bob", 87, "carol", 78, "david");
    await conn.zadd(`${prefix}zset:timestamps`, Date.now() - 3600000, "event1", Date.now() - 1800000, "event2", Date.now(), "event3");

    // Get all keys and their types
    const keys = await conn.keys(`${prefix}*`);
    const keyTypes: Record<string, string> = {};
    const checksums: Record<string, string> = {};

    for (const key of keys) {
      const type = await conn.type(key);
      keyTypes[key] = type;
      checksums[key] = await getRedisKeyChecksum(conn, key, type);
    }

    return { keys, keyTypes, checksums };
  } finally {
    if (shouldClose) {
      await conn.quit();
    }
  }
}

/**
 * Verify Redis restore by comparing data
 */
export async function verifyRedisRestore(
  sourceRedis: Redis,
  restoreRedis: Redis,
  keys: string[]
): Promise<{ match: boolean; differences: string[] }> {
  const differences: string[] = [];

  for (const key of keys) {
    // Check if key exists
    const exists = await restoreRedis.exists(key);
    if (!exists) {
      differences.push(`Key ${key} does not exist in restore`);
      continue;
    }

    // Compare types
    const sourceType = await sourceRedis.type(key);
    const restoreType = await restoreRedis.type(key);

    if (sourceType !== restoreType) {
      differences.push(`Key ${key}: type mismatch (source: ${sourceType}, restore: ${restoreType})`);
      continue;
    }

    // Compare checksums
    const sourceChecksum = await getRedisKeyChecksum(sourceRedis, key, sourceType);
    const restoreChecksum = await getRedisKeyChecksum(restoreRedis, key, restoreType);

    if (sourceChecksum !== restoreChecksum) {
      differences.push(`Key ${key}: data checksum mismatch`);
    }
  }

  return { match: differences.length === 0, differences };
}

/**
 * Clear Redis test keys
 */
export async function clearRedisTestKeys(redis: Redis, pattern = "test:*"): Promise<void> {
  const keys = await redis.keys(pattern);
  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

/**
 * Trigger Redis BGSAVE and wait for completion
 */
export async function triggerRedisSave(redis: Redis, timeoutMs = 30000): Promise<boolean> {
  const initialSave = await redis.lastsave();

  await redis.bgsave();

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    const currentSave = await redis.lastsave();
    if (currentSave > initialSave) {
      return true;
    }
  }

  return false;
}

/**
 * Create a simple checksum of data for comparison
 */
function createDataChecksum(data: unknown): string {
  const crypto = require("crypto");
  const normalized = JSON.stringify(data, Object.keys(data as object).sort());
  return crypto.createHash("md5").update(normalized).digest("hex");
}

/**
 * Get checksum for a Redis key based on its type
 */
async function getRedisKeyChecksum(redis: Redis, key: string, type: string): Promise<string> {
  const crypto = require("crypto");
  let data: string;

  switch (type) {
    case "string":
      data = (await redis.get(key)) || "";
      break;
    case "hash":
      data = JSON.stringify(await redis.hgetall(key));
      break;
    case "list":
      data = JSON.stringify(await redis.lrange(key, 0, -1));
      break;
    case "set":
      data = JSON.stringify((await redis.smembers(key)).sort());
      break;
    case "zset":
      data = JSON.stringify(await redis.zrange(key, 0, -1, "WITHSCORES"));
      break;
    default:
      data = "";
  }

  return crypto.createHash("md5").update(data).digest("hex");
}

/**
 * Connection pool for database tests
 */
export class DatabaseTestContext {
  postgres: PostgresClient | null = null;
  postgresRestore: PostgresClient | null = null;
  mariadb: MariaDBConnection | null = null;
  mariadbRestore: MariaDBConnection | null = null;
  redis: Redis | null = null;
  redisRestore: Redis | null = null;

  async initPostgres(): Promise<void> {
    this.postgres = await createTestPostgres();
    this.postgresRestore = await createTestPostgresRestore();
  }

  async initMariaDB(): Promise<void> {
    this.mariadb = await createTestMariaDB();
    this.mariadbRestore = await createTestMariaDBRestore();
  }

  async initRedis(): Promise<void> {
    this.redis = createTestRedis();
    // Redis restore uses a different port (6380)
    this.redisRestore = new Redis({
      host: process.env.REDIS_RESTORE_HOST || "localhost",
      port: parseInt(process.env.REDIS_RESTORE_PORT || "6380"),
      password: TEST_CONFIG.redis.password,
    });
  }

  async cleanup(): Promise<void> {
    if (this.postgres) {
      await this.postgres.end();
      this.postgres = null;
    }
    if (this.postgresRestore) {
      await this.postgresRestore.end();
      this.postgresRestore = null;
    }
    if (this.mariadb) {
      await this.mariadb.end();
      this.mariadb = null;
    }
    if (this.mariadbRestore) {
      await this.mariadbRestore.end();
      this.mariadbRestore = null;
    }
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
    if (this.redisRestore) {
      await this.redisRestore.quit();
      this.redisRestore = null;
    }
  }
}
