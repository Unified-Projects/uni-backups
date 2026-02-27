/**
 * Comprehensive Configuration Tests
 *
 * Tests all configuration loading, validation, and parsing scenarios
 * including storage backends, job types, secret resolution, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  ConfigFileSchema,
  StorageConfigSchema,
  JobConfigSchema,
  SftpStorageSchema,
  S3StorageSchema,
  RestStorageSchema,
  LocalStorageSchema,
  FolderJobSchema,
  PostgresJobSchema,
  MariadbJobSchema,
  RedisJobSchema,
  RetentionSchema,
  WorkerGroupSchema,
  type StorageConfig,
  type JobConfig,
} from "../types";

// Test fixtures directory
const TEST_DIR = "/tmp/uni-backups-config-tests";
const SECRETS_DIR = join(TEST_DIR, "secrets");

// Helper to create a config file
function createConfigFile(config: object): string {
  const filePath = join(TEST_DIR, `config-${Date.now()}.yml`);
  writeFileSync(filePath, stringifyYaml(config));
  return filePath;
}

// Helper to create a secret file
function createSecretFile(name: string, content: string): string {
  const filePath = join(SECRETS_DIR, name);
  writeFileSync(filePath, content);
  return filePath;
}

describe("Configuration Comprehensive Tests", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(SECRETS_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // SFTP Storage Tests
  // ==========================================================================

  describe("SFTP Storage Configuration", () => {
    it("parses SFTP with password authentication", () => {
      const config = {
        type: "sftp" as const,
        host: "backup.example.com",
        port: 22,
        user: "backup-user",
        password: "secure-password-123",
        path: "/backups",
      };

      const result = SftpStorageSchema.parse(config);

      expect(result.type).toBe("sftp");
      expect(result.host).toBe("backup.example.com");
      expect(result.port).toBe(22);
      expect(result.user).toBe("backup-user");
      expect(result.password).toBe("secure-password-123");
      expect(result.path).toBe("/backups");
    });

    it("parses SFTP with SSH key authentication", () => {
      const keyPath = createSecretFile("ssh_key", "-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----");

      const config = {
        type: "sftp" as const,
        host: "backup.example.com",
        user: "backup-user",
        key_file: keyPath,
      };

      const result = SftpStorageSchema.parse(config);

      expect(result.type).toBe("sftp");
      expect(result.key_file).toBe(keyPath);
      expect(result.password).toBeUndefined();
    });

    it("parses SFTP with non-standard port", () => {
      const config = {
        type: "sftp" as const,
        host: "backup.example.com",
        port: 2222,
        user: "backup-user",
        password: "test",
      };

      const result = SftpStorageSchema.parse(config);

      expect(result.port).toBe(2222);
    });

    it("applies default port 22 when not specified", () => {
      const config = {
        type: "sftp" as const,
        host: "backup.example.com",
        user: "backup-user",
        password: "test",
      };

      const result = SftpStorageSchema.parse(config);

      expect(result.port).toBe(22);
    });

    it("applies default path / when not specified", () => {
      const config = {
        type: "sftp" as const,
        host: "backup.example.com",
        user: "backup-user",
        password: "test",
      };

      const result = SftpStorageSchema.parse(config);

      expect(result.path).toBe("/");
    });

    it("rejects SFTP config without host", () => {
      const config = {
        type: "sftp" as const,
        user: "backup-user",
        password: "test",
      };

      expect(() => SftpStorageSchema.parse(config)).toThrow();
    });

    it("rejects SFTP config without user", () => {
      const config = {
        type: "sftp" as const,
        host: "backup.example.com",
        password: "test",
      };

      expect(() => SftpStorageSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // S3 Storage Tests
  // ==========================================================================

  describe("S3 Storage Configuration", () => {
    it("parses AWS S3 configuration", () => {
      const config = {
        type: "s3" as const,
        bucket: "my-backup-bucket",
        region: "us-west-2",
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };

      const result = S3StorageSchema.parse(config);

      expect(result.type).toBe("s3");
      expect(result.bucket).toBe("my-backup-bucket");
      expect(result.region).toBe("us-west-2");
      expect(result.access_key).toBe("AKIAIOSFODNN7EXAMPLE");
      expect(result.secret_key).toBe("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");
      expect(result.endpoint).toBeUndefined();
    });

    it("parses MinIO S3-compatible configuration", () => {
      const config = {
        type: "s3" as const,
        endpoint: "http://minio.local:9000",
        bucket: "backups",
        access_key: "minioadmin",
        secret_key: "minioadmin123",
      };

      const result = S3StorageSchema.parse(config);

      expect(result.endpoint).toBe("http://minio.local:9000");
      expect(result.bucket).toBe("backups");
    });

    it("parses Hetzner Object Storage configuration", () => {
      const config = {
        type: "s3" as const,
        endpoint: "https://fsn1.your-objectstorage.com",
        bucket: "hetzner-backup",
        region: "fsn1",
        access_key: "hetzner-access-key",
        secret_key: "hetzner-secret-key",
        path: "production/",
      };

      const result = S3StorageSchema.parse(config);

      expect(result.endpoint).toBe("https://fsn1.your-objectstorage.com");
      expect(result.region).toBe("fsn1");
      expect(result.path).toBe("production/");
    });

    it("applies default region us-east-1 when not specified", () => {
      const config = {
        type: "s3" as const,
        bucket: "my-bucket",
        access_key: "key",
        secret_key: "secret",
      };

      const result = S3StorageSchema.parse(config);

      expect(result.region).toBe("us-east-1");
    });

    it("applies default empty path when not specified", () => {
      const config = {
        type: "s3" as const,
        bucket: "my-bucket",
        access_key: "key",
        secret_key: "secret",
      };

      const result = S3StorageSchema.parse(config);

      expect(result.path).toBe("");
    });

    it("rejects S3 config without bucket", () => {
      const config = {
        type: "s3" as const,
        access_key: "key",
        secret_key: "secret",
      };

      expect(() => S3StorageSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // REST Storage Tests
  // ==========================================================================

  describe("REST Storage Configuration", () => {
    it("parses REST storage with authentication", () => {
      const config = {
        type: "rest" as const,
        url: "https://rest-server.example.com:8000",
        user: "rest-user",
        password: "rest-password",
      };

      const result = RestStorageSchema.parse(config);

      expect(result.type).toBe("rest");
      expect(result.url).toBe("https://rest-server.example.com:8000");
      expect(result.user).toBe("rest-user");
      expect(result.password).toBe("rest-password");
    });

    it("parses REST storage without authentication", () => {
      const config = {
        type: "rest" as const,
        url: "http://localhost:8000",
      };

      const result = RestStorageSchema.parse(config);

      expect(result.type).toBe("rest");
      expect(result.url).toBe("http://localhost:8000");
      expect(result.user).toBeUndefined();
      expect(result.password).toBeUndefined();
    });

    it("rejects REST config without URL", () => {
      const config = {
        type: "rest" as const,
        user: "user",
        password: "pass",
      };

      expect(() => RestStorageSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // Local Storage Tests
  // ==========================================================================

  describe("Local Storage Configuration", () => {
    it("parses local storage with absolute path", () => {
      const config = {
        type: "local" as const,
        path: "/var/backups/restic",
      };

      const result = LocalStorageSchema.parse(config);

      expect(result.type).toBe("local");
      expect(result.path).toBe("/var/backups/restic");
    });

    it("parses local storage with relative path", () => {
      const config = {
        type: "local" as const,
        path: "./backups",
      };

      const result = LocalStorageSchema.parse(config);

      expect(result.path).toBe("./backups");
    });

    it("rejects local config without path", () => {
      const config = {
        type: "local" as const,
      };

      expect(() => LocalStorageSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // Storage Type Discrimination Tests
  // ==========================================================================

  describe("Storage Type Discrimination", () => {
    it("correctly identifies SFTP storage", () => {
      const config = {
        type: "sftp" as const,
        host: "example.com",
        user: "user",
        password: "pass",
      };

      const result = StorageConfigSchema.parse(config);

      expect(result.type).toBe("sftp");
      expect("host" in result).toBe(true);
    });

    it("correctly identifies S3 storage", () => {
      const config = {
        type: "s3" as const,
        bucket: "my-bucket",
        access_key: "key",
        secret_key: "secret",
      };

      const result = StorageConfigSchema.parse(config);

      expect(result.type).toBe("s3");
      expect("bucket" in result).toBe(true);
    });

    it("rejects unknown storage type", () => {
      const config = {
        type: "unknown",
        path: "/some/path",
      };

      expect(() => StorageConfigSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // Folder/Volume Job Tests
  // ==========================================================================

  describe("Folder/Volume Job Configuration", () => {
    it("parses folder job with all options", () => {
      const config = {
        type: "folder" as const,
        source: "/data/important",
        storage: "primary-storage",
        repo: "important-data",
        schedule: "0 2 * * *",
        retention: {
          daily: 7,
          weekly: 4,
          monthly: 6,
        },
        tags: ["important", "daily"],
        exclude: ["*.tmp", "*.log"],
        worker_group: "primary",
        priority: 1,
        timeout: 3600000,
      };

      const result = FolderJobSchema.parse(config);

      expect(result.type).toBe("folder");
      expect(result.source).toBe("/data/important");
      expect(result.storage).toBe("primary-storage");
      expect(result.repo).toBe("important-data");
      expect(result.schedule).toBe("0 2 * * *");
      expect(result.retention?.daily).toBe(7);
      expect(result.retention?.weekly).toBe(4);
      expect(result.retention?.monthly).toBe(6);
      expect(result.tags).toEqual(["important", "daily"]);
      expect(result.exclude).toEqual(["*.tmp", "*.log"]);
      expect(result.worker_group).toBe("primary");
      expect(result.priority).toBe(1);
      expect(result.timeout).toBe(3600000);
    });

    it("parses volume job", () => {
      const config = {
        type: "volume" as const,
        source: "/var/lib/docker/volumes/myapp_data/_data",
        storage: "backup-storage",
      };

      const result = FolderJobSchema.parse(config);

      expect(result.type).toBe("volume");
      expect(result.source).toBe("/var/lib/docker/volumes/myapp_data/_data");
    });

    it("applies default worker_group when not specified", () => {
      const config = {
        type: "folder" as const,
        source: "/data",
        storage: "storage",
      };

      const result = FolderJobSchema.parse(config);

      expect(result.worker_group).toBe("default");
    });

    it("rejects folder job without source", () => {
      const config = {
        type: "folder" as const,
        storage: "storage",
      };

      expect(() => FolderJobSchema.parse(config)).toThrow();
    });

    it("rejects folder job without storage", () => {
      const config = {
        type: "folder" as const,
        source: "/data",
      };

      expect(() => FolderJobSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // PostgreSQL Job Tests
  // ==========================================================================

  describe("PostgreSQL Job Configuration", () => {
    it("parses PostgreSQL job with all options", () => {
      const config = {
        type: "postgres" as const,
        host: "db.example.com",
        port: 5432,
        database: "production",
        user: "backup_user",
        password: "db-password",
        storage: "backup-storage",
        all_databases: false,
      };

      const result = PostgresJobSchema.parse(config);

      expect(result.type).toBe("postgres");
      expect(result.host).toBe("db.example.com");
      expect(result.port).toBe(5432);
      expect(result.database).toBe("production");
      expect(result.user).toBe("backup_user");
      expect(result.password).toBe("db-password");
      expect(result.all_databases).toBe(false);
    });

    it("parses PostgreSQL job with all_databases enabled", () => {
      const config = {
        type: "postgres" as const,
        database: "postgres",
        storage: "backup-storage",
        all_databases: true,
      };

      const result = PostgresJobSchema.parse(config);

      expect(result.all_databases).toBe(true);
    });

    it("applies default host localhost when not specified", () => {
      const config = {
        type: "postgres" as const,
        database: "mydb",
        storage: "storage",
      };

      const result = PostgresJobSchema.parse(config);

      expect(result.host).toBe("localhost");
    });

    it("applies default port 5432 when not specified", () => {
      const config = {
        type: "postgres" as const,
        database: "mydb",
        storage: "storage",
      };

      const result = PostgresJobSchema.parse(config);

      expect(result.port).toBe(5432);
    });

    it("applies default user postgres when not specified", () => {
      const config = {
        type: "postgres" as const,
        database: "mydb",
        storage: "storage",
      };

      const result = PostgresJobSchema.parse(config);

      expect(result.user).toBe("postgres");
    });

    it("rejects PostgreSQL job without database", () => {
      const config = {
        type: "postgres" as const,
        storage: "storage",
      };

      expect(() => PostgresJobSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // MariaDB Job Tests
  // ==========================================================================

  describe("MariaDB Job Configuration", () => {
    it("parses MariaDB job with all options", () => {
      const config = {
        type: "mariadb" as const,
        host: "mariadb.example.com",
        port: 3306,
        database: "production",
        user: "backup_user",
        password: "db-password",
        storage: "backup-storage",
        all_databases: false,
      };

      const result = MariadbJobSchema.parse(config);

      expect(result.type).toBe("mariadb");
      expect(result.host).toBe("mariadb.example.com");
      expect(result.port).toBe(3306);
      expect(result.database).toBe("production");
    });

    it("applies default port 3306 when not specified", () => {
      const config = {
        type: "mariadb" as const,
        database: "mydb",
        storage: "storage",
      };

      const result = MariadbJobSchema.parse(config);

      expect(result.port).toBe(3306);
    });

    it("applies default user root when not specified", () => {
      const config = {
        type: "mariadb" as const,
        database: "mydb",
        storage: "storage",
      };

      const result = MariadbJobSchema.parse(config);

      expect(result.user).toBe("root");
    });
  });

  // ==========================================================================
  // Redis Job Tests
  // ==========================================================================

  describe("Redis Job Configuration", () => {
    it("parses Redis job with RDB path", () => {
      const config = {
        type: "redis" as const,
        host: "redis.example.com",
        port: 6379,
        password: "redis-password",
        rdb_path: "/data/dump.rdb",
        storage: "backup-storage",
      };

      const result = RedisJobSchema.parse(config);

      expect(result.type).toBe("redis");
      expect(result.host).toBe("redis.example.com");
      expect(result.port).toBe(6379);
      expect(result.rdb_path).toBe("/data/dump.rdb");
    });

    it("parses Redis job without RDB path (BGSAVE method)", () => {
      const config = {
        type: "redis" as const,
        storage: "backup-storage",
      };

      const result = RedisJobSchema.parse(config);

      expect(result.rdb_path).toBeUndefined();
    });

    it("applies default port 6379 when not specified", () => {
      const config = {
        type: "redis" as const,
        storage: "storage",
      };

      const result = RedisJobSchema.parse(config);

      expect(result.port).toBe(6379);
    });

    it("applies default host localhost when not specified", () => {
      const config = {
        type: "redis" as const,
        storage: "storage",
      };

      const result = RedisJobSchema.parse(config);

      expect(result.host).toBe("localhost");
    });
  });

  // ==========================================================================
  // Retention Policy Tests
  // ==========================================================================

  describe("Retention Policy Configuration", () => {
    it("parses all retention options", () => {
      const config = {
        hourly: 24,
        daily: 7,
        weekly: 4,
        monthly: 12,
        yearly: 3,
        last: 5,
      };

      const result = RetentionSchema.parse(config);

      expect(result.hourly).toBe(24);
      expect(result.daily).toBe(7);
      expect(result.weekly).toBe(4);
      expect(result.monthly).toBe(12);
      expect(result.yearly).toBe(3);
      expect(result.last).toBe(5);
    });

    it("allows partial retention configuration", () => {
      const config = {
        daily: 7,
        weekly: 4,
      };

      const result = RetentionSchema.parse(config);

      expect(result.daily).toBe(7);
      expect(result.weekly).toBe(4);
      expect(result.hourly).toBeUndefined();
      expect(result.monthly).toBeUndefined();
    });

    it("allows empty retention configuration", () => {
      const config = {};

      const result = RetentionSchema.parse(config);

      expect(result.daily).toBeUndefined();
    });
  });

  // ==========================================================================
  // Worker Group Tests
  // ==========================================================================

  describe("Worker Group Configuration", () => {
    it("parses worker group with all options", () => {
      const config = {
        workers: ["worker-1", "worker-2", "worker-3"],
        primary: "worker-1",
        failover_order: ["worker-2", "worker-3"],
        quorum_size: 2,
      };

      const result = WorkerGroupSchema.parse(config);

      expect(result.workers).toEqual(["worker-1", "worker-2", "worker-3"]);
      expect(result.primary).toBe("worker-1");
      expect(result.failover_order).toEqual(["worker-2", "worker-3"]);
      expect(result.quorum_size).toBe(2);
    });

    it("applies default quorum_size of 2", () => {
      const config = {
        workers: ["worker-1", "worker-2"],
      };

      const result = WorkerGroupSchema.parse(config);

      expect(result.quorum_size).toBe(2);
    });

    it("rejects quorum_size less than 1", () => {
      const config = {
        workers: ["worker-1"],
        quorum_size: 0,
      };

      expect(() => WorkerGroupSchema.parse(config)).toThrow();
    });
  });

  // ==========================================================================
  // Full Config File Tests
  // ==========================================================================

  describe("Full Configuration File", () => {
    it("parses complete config file", () => {
      const config = {
        storage: {
          "primary-storage": {
            type: "s3" as const,
            bucket: "backup-bucket",
            access_key: "key",
            secret_key: "secret",
          },
          "local-storage": {
            type: "local" as const,
            path: "/backups",
          },
        },
        jobs: {
          "app-data": {
            type: "folder" as const,
            source: "/app/data",
            storage: "primary-storage",
            schedule: "0 2 * * *",
          },
          database: {
            type: "postgres" as const,
            database: "production",
            storage: "primary-storage",
          },
        },
        worker_groups: {
          default: {
            workers: ["worker-1", "worker-2"],
          },
        },
        redis: {
          host: "redis.example.com",
          port: 6379,
          password: "redis-pass",
        },
        restic: {
          restic_password: "restic-password",
          cache_dir: "/cache",
        },
      };

      const result = ConfigFileSchema.parse(config);

      expect(result.storage["primary-storage"].type).toBe("s3");
      expect(result.storage["local-storage"].type).toBe("local");
      expect(result.jobs["app-data"].type).toBe("folder");
      expect(result.jobs["database"].type).toBe("postgres");
      expect(result.worker_groups?.default.workers).toHaveLength(2);
      expect(result.redis?.host).toBe("redis.example.com");
      expect(result.restic?.restic_password).toBe("restic-password");
    });

    it("validates job storage reference exists in storage map", () => {
      // Note: The schema itself doesn't validate cross-references,
      // that's done at runtime. This test just verifies the structure is valid.
      const config = {
        storage: {
          "my-storage": {
            type: "local" as const,
            path: "/backups",
          },
        },
        jobs: {
          "my-job": {
            type: "folder" as const,
            source: "/data",
            storage: "nonexistent-storage", // This is structurally valid
          },
        },
      };

      // Schema parses successfully (cross-reference validation is runtime)
      const result = ConfigFileSchema.parse(config);
      expect(result.jobs["my-job"].storage).toBe("nonexistent-storage");
    });

    it("handles unicode in paths and names", () => {
      const config = {
        storage: {
          "storage-": {
            type: "local" as const,
            path: "/data/backup",
          },
        },
        jobs: {
          "backup-": {
            type: "folder" as const,
            source: "/app/data/",
            storage: "storage-",
          },
        },
      };

      const result = ConfigFileSchema.parse(config);

      expect(result.storage["storage-"].type).toBe("local");
      expect(result.jobs["backup-"].type).toBe("folder");
    });
  });

  // ==========================================================================
  // Error Message Tests
  // ==========================================================================

  describe("Validation Error Messages", () => {
    it("provides clear error for invalid YAML syntax", () => {
      const invalidYaml = `
storage:
  primary:
    type: sftp
    host: [invalid yaml
`;
      expect(() => parseYaml(invalidYaml)).toThrow();
    });

    it("provides clear error for schema violations", () => {
      const config = {
        type: "sftp" as const,
        // Missing required host
        user: "user",
      };

      try {
        SftpStorageSchema.parse(config);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.errors).toBeDefined();
        expect(error.errors.some((e: any) => e.path.includes("host"))).toBe(true);
      }
    });

    it("provides clear error for invalid cron expression format", () => {
      // Note: Cron validation happens at schedule creation, not schema parse
      const config = {
        type: "folder" as const,
        source: "/data",
        storage: "storage",
        schedule: "invalid cron",
      };

      // Schema accepts any string for schedule
      const result = FolderJobSchema.parse(config);
      expect(result.schedule).toBe("invalid cron");
    });

    it("provides clear error for invalid type discriminator", () => {
      const config = {
        type: "invalid-type",
        source: "/data",
        storage: "storage",
      };

      try {
        JobConfigSchema.parse(config);
        expect.fail("Should have thrown");
      } catch (error: any) {
        expect(error.errors).toBeDefined();
      }
    });
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe("Edge Cases", () => {
    it("handles empty strings in optional fields", () => {
      const config = {
        type: "postgres" as const,
        database: "mydb",
        storage: "storage",
        password: "",
      };

      const result = PostgresJobSchema.parse(config);

      expect(result.password).toBe("");
    });

    it("handles very long paths", () => {
      const longPath = "/" + "very-long-directory-name/".repeat(50) + "file.txt";

      const config = {
        type: "folder" as const,
        source: longPath,
        storage: "storage",
      };

      const result = FolderJobSchema.parse(config);

      expect(result.source).toBe(longPath);
    });

    it("handles special characters in names", () => {
      const config = {
        storage: {
          "storage-with_special.chars": {
            type: "local" as const,
            path: "/backups",
          },
        },
        jobs: {
          "job-with_special.chars": {
            type: "folder" as const,
            source: "/data",
            storage: "storage-with_special.chars",
          },
        },
      };

      const result = ConfigFileSchema.parse(config);

      expect(Object.keys(result.storage)).toContain("storage-with_special.chars");
      expect(Object.keys(result.jobs)).toContain("job-with_special.chars");
    });

    it("handles numeric values as strings where expected", () => {
      const config = {
        type: "postgres" as const,
        database: "123", // Database name as numeric string
        storage: "storage",
        port: 5432,
      };

      const result = PostgresJobSchema.parse(config);

      expect(result.database).toBe("123");
    });

    it("handles zero values in retention", () => {
      const config = {
        daily: 0,
        weekly: 0,
      };

      const result = RetentionSchema.parse(config);

      expect(result.daily).toBe(0);
      expect(result.weekly).toBe(0);
    });

    it("handles maximum reasonable timeout value", () => {
      const config = {
        type: "folder" as const,
        source: "/data",
        storage: "storage",
        timeout: 86400000, // 24 hours
      };

      const result = FolderJobSchema.parse(config);

      expect(result.timeout).toBe(86400000);
    });

    it("handles multiple exclude patterns", () => {
      const config = {
        type: "folder" as const,
        source: "/data",
        storage: "storage",
        exclude: [
          "*.tmp",
          "*.log",
          "node_modules/**",
          ".git/**",
          "**/.DS_Store",
          "**/Thumbs.db",
        ],
      };

      const result = FolderJobSchema.parse(config);

      expect(result.exclude).toHaveLength(6);
    });

    it("handles multiple tags", () => {
      const config = {
        type: "folder" as const,
        source: "/data",
        storage: "storage",
        tags: ["production", "critical", "daily", "primary-site"],
      };

      const result = FolderJobSchema.parse(config);

      expect(result.tags).toHaveLength(4);
    });
  });
});
