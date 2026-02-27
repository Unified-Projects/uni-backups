import { describe, it, expect } from "vitest";
import {
  StorageConfigSchema,
  JobConfigSchema,
  RetentionSchema,
  SftpStorageSchema,
  S3StorageSchema,
  RestStorageSchema,
  LocalStorageSchema,
  RCloneStorageSchema,
  FolderJobSchema,
  PostgresJobSchema,
  MariadbJobSchema,
  RedisJobSchema,
  ConfigFileSchema,
} from "../types";

describe("Storage Schemas", () => {
  describe("SftpStorageSchema", () => {
    it("parses valid SFTP config with all fields", () => {
      const config = {
        type: "sftp",
        host: "backup.example.com",
        port: 2222,
        user: "backupuser",
        password: "secret123",
        path: "/backups/restic",
      };
      const result = SftpStorageSchema.parse(config);
      expect(result.type).toBe("sftp");
      expect(result.host).toBe("backup.example.com");
      expect(result.port).toBe(2222);
      expect(result.user).toBe("backupuser");
      expect(result.password).toBe("secret123");
      expect(result.path).toBe("/backups/restic");
    });

    it("applies default port 22", () => {
      const config = {
        type: "sftp",
        host: "backup.example.com",
        user: "backupuser",
      };
      const result = SftpStorageSchema.parse(config);
      expect(result.port).toBe(22);
    });

    it("applies default path /", () => {
      const config = {
        type: "sftp",
        host: "backup.example.com",
        user: "backupuser",
      };
      const result = SftpStorageSchema.parse(config);
      expect(result.path).toBe("/");
    });

    it("accepts password_file instead of password", () => {
      const config = {
        type: "sftp",
        host: "backup.example.com",
        user: "backupuser",
        password_file: "/run/secrets/sftp_password",
      };
      const result = SftpStorageSchema.parse(config);
      expect(result.password_file).toBe("/run/secrets/sftp_password");
      expect(result.password).toBeUndefined();
    });

    it("accepts key_file for SSH key auth", () => {
      const config = {
        type: "sftp",
        host: "backup.example.com",
        user: "backupuser",
        key_file: "/home/user/.ssh/id_rsa",
      };
      const result = SftpStorageSchema.parse(config);
      expect(result.key_file).toBe("/home/user/.ssh/id_rsa");
    });

    it("rejects missing host", () => {
      const config = {
        type: "sftp",
        user: "backupuser",
      };
      expect(() => SftpStorageSchema.parse(config)).toThrow();
    });

    it("rejects missing user", () => {
      const config = {
        type: "sftp",
        host: "backup.example.com",
      };
      expect(() => SftpStorageSchema.parse(config)).toThrow();
    });
  });

  describe("S3StorageSchema", () => {
    it("parses valid S3 config with endpoint (MinIO)", () => {
      const config = {
        type: "s3",
        endpoint: "http://minio.local:9000",
        bucket: "backups",
        region: "us-east-1",
        access_key: "minioadmin",
        secret_key: "minioadmin123",
        path: "restic-repos",
      };
      const result = S3StorageSchema.parse(config);
      expect(result.type).toBe("s3");
      expect(result.endpoint).toBe("http://minio.local:9000");
      expect(result.bucket).toBe("backups");
      expect(result.region).toBe("us-east-1");
      expect(result.access_key).toBe("minioadmin");
      expect(result.secret_key).toBe("minioadmin123");
      expect(result.path).toBe("restic-repos");
    });

    it("parses AWS S3 config without endpoint", () => {
      const config = {
        type: "s3",
        bucket: "my-backups-bucket",
        region: "eu-west-1",
        access_key: "AKIAIOSFODNN7EXAMPLE",
        secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      };
      const result = S3StorageSchema.parse(config);
      expect(result.endpoint).toBeUndefined();
      expect(result.bucket).toBe("my-backups-bucket");
      expect(result.region).toBe("eu-west-1");
    });

    it("applies default region us-east-1", () => {
      const config = {
        type: "s3",
        bucket: "backups",
      };
      const result = S3StorageSchema.parse(config);
      expect(result.region).toBe("us-east-1");
    });

    it("applies default empty path", () => {
      const config = {
        type: "s3",
        bucket: "backups",
      };
      const result = S3StorageSchema.parse(config);
      expect(result.path).toBe("");
    });

    it("accepts _file variants for secrets", () => {
      const config = {
        type: "s3",
        bucket: "backups",
        access_key_file: "/run/secrets/aws_access_key",
        secret_key_file: "/run/secrets/aws_secret_key",
      };
      const result = S3StorageSchema.parse(config);
      expect(result.access_key_file).toBe("/run/secrets/aws_access_key");
      expect(result.secret_key_file).toBe("/run/secrets/aws_secret_key");
    });

    it("rejects missing bucket", () => {
      const config = {
        type: "s3",
        region: "us-east-1",
      };
      expect(() => S3StorageSchema.parse(config)).toThrow();
    });
  });

  describe("RestStorageSchema", () => {
    it("parses valid REST server config", () => {
      const config = {
        type: "rest",
        url: "http://rest-server.local:8000",
        user: "backup",
        password: "secret",
      };
      const result = RestStorageSchema.parse(config);
      expect(result.type).toBe("rest");
      expect(result.url).toBe("http://rest-server.local:8000");
      expect(result.user).toBe("backup");
      expect(result.password).toBe("secret");
    });

    it("parses REST config without auth", () => {
      const config = {
        type: "rest",
        url: "http://rest-server.local:8000",
      };
      const result = RestStorageSchema.parse(config);
      expect(result.user).toBeUndefined();
      expect(result.password).toBeUndefined();
    });

    it("accepts password_file", () => {
      const config = {
        type: "rest",
        url: "http://rest-server.local:8000",
        user: "backup",
        password_file: "/run/secrets/rest_password",
      };
      const result = RestStorageSchema.parse(config);
      expect(result.password_file).toBe("/run/secrets/rest_password");
    });

    it("rejects missing url", () => {
      const config = {
        type: "rest",
      };
      expect(() => RestStorageSchema.parse(config)).toThrow();
    });
  });

  describe("RCloneStorageSchema", () => {
    it("parses valid rclone config with config_file", () => {
      const config = {
        type: "rclone",
        remote: "gdrive",
        path: "restic-backups",
        config_file: "/run/secrets/rclone.conf",
      };
      const result = RCloneStorageSchema.parse(config);
      expect(result.type).toBe("rclone");
      expect(result.remote).toBe("gdrive");
      expect(result.path).toBe("restic-backups");
      expect(result.config_file).toBe("/run/secrets/rclone.conf");
      expect(result.config).toBeUndefined();
    });

    it("parses valid rclone config with inline config map", () => {
      const config = {
        type: "rclone",
        remote: "b2",
        path: "backups",
        config: {
          type: "b2",
          account: "my-account-id",
          key: "my-application-key",
        },
      };
      const result = RCloneStorageSchema.parse(config);
      expect(result.type).toBe("rclone");
      expect(result.remote).toBe("b2");
      expect(result.config?.type).toBe("b2");
      expect(result.config?.account).toBe("my-account-id");
      expect(result.config?.key).toBe("my-application-key");
      expect(result.config_file).toBeUndefined();
    });

    it("applies default empty path", () => {
      const config = {
        type: "rclone",
        remote: "myremote",
      };
      const result = RCloneStorageSchema.parse(config);
      expect(result.path).toBe("");
    });

    it("rejects missing remote", () => {
      const config = {
        type: "rclone",
        path: "backups",
      };
      expect(() => RCloneStorageSchema.parse(config)).toThrow();
    });
  });

  describe("LocalStorageSchema", () => {
    it("parses valid local storage config", () => {
      const config = {
        type: "local",
        path: "/var/backups/restic",
      };
      const result = LocalStorageSchema.parse(config);
      expect(result.type).toBe("local");
      expect(result.path).toBe("/var/backups/restic");
    });

    it("rejects missing path", () => {
      const config = {
        type: "local",
      };
      expect(() => LocalStorageSchema.parse(config)).toThrow();
    });
  });

  describe("StorageConfigSchema (discriminated union)", () => {
    it("parses SFTP storage", () => {
      const config = { type: "sftp", host: "host", user: "user" };
      const result = StorageConfigSchema.parse(config);
      expect(result.type).toBe("sftp");
    });

    it("parses S3 storage", () => {
      const config = { type: "s3", bucket: "bucket" };
      const result = StorageConfigSchema.parse(config);
      expect(result.type).toBe("s3");
    });

    it("parses REST storage", () => {
      const config = { type: "rest", url: "http://localhost:8000" };
      const result = StorageConfigSchema.parse(config);
      expect(result.type).toBe("rest");
    });

    it("parses local storage", () => {
      const config = { type: "local", path: "/backups" };
      const result = StorageConfigSchema.parse(config);
      expect(result.type).toBe("local");
    });

    it("parses rclone storage", () => {
      const config = { type: "rclone", remote: "gdrive", path: "backups" };
      const result = StorageConfigSchema.parse(config);
      expect(result.type).toBe("rclone");
    });

    it("rejects invalid storage type", () => {
      const config = { type: "invalid", path: "/backups" };
      expect(() => StorageConfigSchema.parse(config)).toThrow();
    });
  });
});

describe("RetentionSchema", () => {
  it("parses full retention policy", () => {
    const retention = {
      hourly: 24,
      daily: 7,
      weekly: 4,
      monthly: 12,
      yearly: 3,
      last: 10,
    };
    const result = RetentionSchema.parse(retention);
    expect(result.hourly).toBe(24);
    expect(result.daily).toBe(7);
    expect(result.weekly).toBe(4);
    expect(result.monthly).toBe(12);
    expect(result.yearly).toBe(3);
    expect(result.last).toBe(10);
  });

  it("parses partial retention policy", () => {
    const retention = {
      daily: 7,
      weekly: 4,
    };
    const result = RetentionSchema.parse(retention);
    expect(result.daily).toBe(7);
    expect(result.weekly).toBe(4);
    expect(result.hourly).toBeUndefined();
    expect(result.monthly).toBeUndefined();
  });

  it("parses empty retention policy", () => {
    const result = RetentionSchema.parse({});
    expect(result.hourly).toBeUndefined();
    expect(result.daily).toBeUndefined();
  });

  it("parses last-only retention", () => {
    const retention = { last: 5 };
    const result = RetentionSchema.parse(retention);
    expect(result.last).toBe(5);
  });
});

describe("Job Schemas", () => {
  describe("FolderJobSchema", () => {
    it("parses valid folder job", () => {
      const job = {
        type: "folder",
        source: "/home/user/documents",
        storage: "local-storage",
        repo: "documents-backup",
        schedule: "0 2 * * *",
        retention: { daily: 7, weekly: 4 },
        tags: ["documents", "important"],
        exclude: ["*.tmp", "cache/**"],
      };
      const result = FolderJobSchema.parse(job);
      expect(result.type).toBe("folder");
      expect(result.source).toBe("/home/user/documents");
      expect(result.storage).toBe("local-storage");
      expect(result.repo).toBe("documents-backup");
      expect(result.schedule).toBe("0 2 * * *");
      expect(result.retention?.daily).toBe(7);
      expect(result.tags).toEqual(["documents", "important"]);
      expect(result.exclude).toEqual(["*.tmp", "cache/**"]);
    });

    it("parses volume job", () => {
      const job = {
        type: "volume",
        source: "/var/lib/docker/volumes/data/_data",
        storage: "s3-storage",
      };
      const result = FolderJobSchema.parse(job);
      expect(result.type).toBe("volume");
      expect(result.source).toBe("/var/lib/docker/volumes/data/_data");
    });

    it("allows optional repo (defaults to job name)", () => {
      const job = {
        type: "folder",
        source: "/data",
        storage: "local",
      };
      const result = FolderJobSchema.parse(job);
      expect(result.repo).toBeUndefined();
    });

    it("allows optional schedule", () => {
      const job = {
        type: "folder",
        source: "/data",
        storage: "local",
      };
      const result = FolderJobSchema.parse(job);
      expect(result.schedule).toBeUndefined();
    });

    it("rejects missing source", () => {
      const job = {
        type: "folder",
        storage: "local",
      };
      expect(() => FolderJobSchema.parse(job)).toThrow();
    });

    it("rejects missing storage", () => {
      const job = {
        type: "folder",
        source: "/data",
      };
      expect(() => FolderJobSchema.parse(job)).toThrow();
    });
  });

  describe("PostgresJobSchema", () => {
    it("parses valid postgres job with all fields", () => {
      const job = {
        type: "postgres",
        host: "db.example.com",
        port: 5433,
        database: "production",
        user: "backup_user",
        password: "secret123",
        storage: "s3-storage",
        repo: "postgres-backup",
        schedule: "0 3 * * *",
        retention: { daily: 7, weekly: 4, monthly: 12 },
        tags: ["postgres", "production"],
      };
      const result = PostgresJobSchema.parse(job);
      expect(result.type).toBe("postgres");
      expect(result.host).toBe("db.example.com");
      expect(result.port).toBe(5433);
      expect(result.database).toBe("production");
      expect(result.user).toBe("backup_user");
      expect(result.password).toBe("secret123");
      expect(result.all_databases).toBe(false);
    });

    it("applies default host localhost", () => {
      const job = {
        type: "postgres",
        database: "test",
        storage: "local",
      };
      const result = PostgresJobSchema.parse(job);
      expect(result.host).toBe("localhost");
    });

    it("applies default port 5432", () => {
      const job = {
        type: "postgres",
        database: "test",
        storage: "local",
      };
      const result = PostgresJobSchema.parse(job);
      expect(result.port).toBe(5432);
    });

    it("applies default user postgres", () => {
      const job = {
        type: "postgres",
        database: "test",
        storage: "local",
      };
      const result = PostgresJobSchema.parse(job);
      expect(result.user).toBe("postgres");
    });

    it("applies default all_databases false", () => {
      const job = {
        type: "postgres",
        database: "test",
        storage: "local",
      };
      const result = PostgresJobSchema.parse(job);
      expect(result.all_databases).toBe(false);
    });

    it("parses all_databases true for pg_dumpall", () => {
      const job = {
        type: "postgres",
        database: "postgres",
        storage: "local",
        all_databases: true,
      };
      const result = PostgresJobSchema.parse(job);
      expect(result.all_databases).toBe(true);
    });

    it("accepts password_file", () => {
      const job = {
        type: "postgres",
        database: "test",
        storage: "local",
        password_file: "/run/secrets/pg_password",
      };
      const result = PostgresJobSchema.parse(job);
      expect(result.password_file).toBe("/run/secrets/pg_password");
    });

    it("rejects missing database", () => {
      const job = {
        type: "postgres",
        storage: "local",
      };
      expect(() => PostgresJobSchema.parse(job)).toThrow();
    });
  });

  describe("MariadbJobSchema", () => {
    it("parses valid mariadb job", () => {
      const job = {
        type: "mariadb",
        host: "mysql.example.com",
        port: 3307,
        database: "production",
        user: "backup_user",
        password: "secret123",
        storage: "sftp-storage",
      };
      const result = MariadbJobSchema.parse(job);
      expect(result.type).toBe("mariadb");
      expect(result.host).toBe("mysql.example.com");
      expect(result.port).toBe(3307);
      expect(result.database).toBe("production");
      expect(result.user).toBe("backup_user");
    });

    it("applies default host localhost", () => {
      const job = {
        type: "mariadb",
        database: "test",
        storage: "local",
      };
      const result = MariadbJobSchema.parse(job);
      expect(result.host).toBe("localhost");
    });

    it("applies default port 3306", () => {
      const job = {
        type: "mariadb",
        database: "test",
        storage: "local",
      };
      const result = MariadbJobSchema.parse(job);
      expect(result.port).toBe(3306);
    });

    it("applies default user root", () => {
      const job = {
        type: "mariadb",
        database: "test",
        storage: "local",
      };
      const result = MariadbJobSchema.parse(job);
      expect(result.user).toBe("root");
    });

    it("parses all_databases for mysqldump --all-databases", () => {
      const job = {
        type: "mariadb",
        database: "mysql",
        storage: "local",
        all_databases: true,
      };
      const result = MariadbJobSchema.parse(job);
      expect(result.all_databases).toBe(true);
    });
  });

  describe("RedisJobSchema", () => {
    it("parses valid redis job", () => {
      const job = {
        type: "redis",
        host: "redis.example.com",
        port: 6380,
        password: "redispass",
        rdb_path: "/var/lib/redis/dump.rdb",
        storage: "s3-storage",
      };
      const result = RedisJobSchema.parse(job);
      expect(result.type).toBe("redis");
      expect(result.host).toBe("redis.example.com");
      expect(result.port).toBe(6380);
      expect(result.password).toBe("redispass");
      expect(result.rdb_path).toBe("/var/lib/redis/dump.rdb");
    });

    it("applies default host localhost", () => {
      const job = {
        type: "redis",
        storage: "local",
      };
      const result = RedisJobSchema.parse(job);
      expect(result.host).toBe("localhost");
    });

    it("applies default port 6379", () => {
      const job = {
        type: "redis",
        storage: "local",
      };
      const result = RedisJobSchema.parse(job);
      expect(result.port).toBe(6379);
    });

    it("parses without rdb_path (uses BGSAVE)", () => {
      const job = {
        type: "redis",
        storage: "local",
      };
      const result = RedisJobSchema.parse(job);
      expect(result.rdb_path).toBeUndefined();
    });

    it("accepts password_file", () => {
      const job = {
        type: "redis",
        storage: "local",
        password_file: "/run/secrets/redis_password",
      };
      const result = RedisJobSchema.parse(job);
      expect(result.password_file).toBe("/run/secrets/redis_password");
    });
  });

  describe("JobConfigSchema (discriminated union)", () => {
    it("parses folder job", () => {
      const job = { type: "folder", source: "/data", storage: "local" };
      const result = JobConfigSchema.parse(job);
      expect(result.type).toBe("folder");
    });

    it("parses volume job", () => {
      const job = { type: "volume", source: "/data", storage: "local" };
      const result = JobConfigSchema.parse(job);
      expect(result.type).toBe("volume");
    });

    it("parses postgres job", () => {
      const job = { type: "postgres", database: "test", storage: "local" };
      const result = JobConfigSchema.parse(job);
      expect(result.type).toBe("postgres");
    });

    it("parses mariadb job", () => {
      const job = { type: "mariadb", database: "test", storage: "local" };
      const result = JobConfigSchema.parse(job);
      expect(result.type).toBe("mariadb");
    });

    it("parses redis job", () => {
      const job = { type: "redis", storage: "local" };
      const result = JobConfigSchema.parse(job);
      expect(result.type).toBe("redis");
    });

    it("rejects invalid job type", () => {
      const job = { type: "mongodb", database: "test", storage: "local" };
      expect(() => JobConfigSchema.parse(job)).toThrow();
    });
  });
});

describe("ConfigFileSchema", () => {
  it("parses complete config file", () => {
    const config = {
      storage: {
        "local-backup": {
          type: "local",
          path: "/backups",
        },
        "s3-backup": {
          type: "s3",
          bucket: "my-backups",
          region: "eu-west-1",
          access_key: "key",
          secret_key: "secret",
        },
      },
      jobs: {
        "daily-backup": {
          type: "folder",
          source: "/data",
          storage: "local-backup",
          schedule: "0 2 * * *",
          retention: { daily: 7, weekly: 4 },
        },
        "postgres-backup": {
          type: "postgres",
          database: "production",
          storage: "s3-backup",
          schedule: "0 3 * * *",
        },
      },
      restic: {
        restic_password: "restic-password",
        cache_dir: "/tmp/restic-cache",
      },
    };
    const result = ConfigFileSchema.parse(config);
    expect(Object.keys(result.storage)).toHaveLength(2);
    expect(Object.keys(result.jobs)).toHaveLength(2);
    expect(result.restic?.restic_password).toBe("restic-password");
    expect(result.restic?.cache_dir).toBe("/tmp/restic-cache");
  });

  it("parses config without restic section", () => {
    const config = {
      storage: {
        local: { type: "local", path: "/backups" },
      },
      jobs: {
        backup: { type: "folder", source: "/data", storage: "local" },
      },
    };
    const result = ConfigFileSchema.parse(config);
    expect(result.restic).toBeUndefined();
  });

  it("parses restic with restic_password_file", () => {
    const config = {
      storage: {
        local: { type: "local", path: "/backups" },
      },
      jobs: {
        backup: { type: "folder", source: "/data", storage: "local" },
      },
      restic: {
        restic_password_file: "/run/secrets/restic_password",
      },
    };
    const result = ConfigFileSchema.parse(config);
    expect(result.restic?.restic_password_file).toBe("/run/secrets/restic_password");
  });

  it("rejects config with no storage", () => {
    const config = {
      jobs: {
        backup: { type: "folder", source: "/data", storage: "local" },
      },
    };
    expect(() => ConfigFileSchema.parse(config)).toThrow();
  });

  it("rejects config with no jobs", () => {
    const config = {
      storage: {
        local: { type: "local", path: "/backups" },
      },
    };
    expect(() => ConfigFileSchema.parse(config)).toThrow();
  });
});
