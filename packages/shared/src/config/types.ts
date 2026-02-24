import { z } from "zod";

export const StorageType = z.enum(["sftp", "s3", "rest", "local"]);
export type StorageType = z.infer<typeof StorageType>;

export const SftpStorageSchema = z.object({
  type: z.literal("sftp"),
  host: z.string(),
  port: z.number().default(22),
  user: z.string(),
  password: z.string().optional(),
  password_file: z.string().optional(),
  key_file: z.string().optional(),
  path: z.string().default("/"),
});

export const S3StorageSchema = z.object({
  type: z.literal("s3"),
  endpoint: z.string().optional(), // Required for non-AWS S3
  bucket: z.string(),
  region: z.string().default("us-east-1"),
  access_key: z.string().optional(),
  access_key_file: z.string().optional(),
  secret_key: z.string().optional(),
  secret_key_file: z.string().optional(),
  path: z.string().default(""), // Prefix within bucket
});

export const RestStorageSchema = z.object({
  type: z.literal("rest"),
  url: z.string(),
  user: z.string().optional(),
  password: z.string().optional(),
  password_file: z.string().optional(),
});

export const LocalStorageSchema = z.object({
  type: z.literal("local"),
  path: z.string(),
});

export const StorageConfigSchema = z.discriminatedUnion("type", [
  SftpStorageSchema,
  S3StorageSchema,
  RestStorageSchema,
  LocalStorageSchema,
]);

export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type SftpStorage = z.infer<typeof SftpStorageSchema>;
export type S3Storage = z.infer<typeof S3StorageSchema>;
export type RestStorage = z.infer<typeof RestStorageSchema>;
export type LocalStorage = z.infer<typeof LocalStorageSchema>;

export const JobType = z.enum(["volume", "folder", "postgres", "mariadb", "redis"]);
export type JobType = z.infer<typeof JobType>;

export const RetentionSchema = z.object({
  hourly: z.number().optional(),
  daily: z.number().optional(),
  weekly: z.number().optional(),
  monthly: z.number().optional(),
  yearly: z.number().optional(),
  last: z.number().optional(), // Keep last N snapshots
});
export type Retention = z.infer<typeof RetentionSchema>;

const BaseJobSchema = z.object({
  storage: z.string(),
  repo: z.string().optional(),
  schedule: z.string().optional(),
  retention: RetentionSchema.optional(),
  tags: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  worker_group: z.string().default("default"),
  priority: z.number().optional(),
  timeout: z.number().optional(),
});

export const FolderJobSchema = BaseJobSchema.extend({
  type: z.enum(["volume", "folder"]),
  source: z.string(),
});

export const PostgresJobSchema = BaseJobSchema.extend({
  type: z.literal("postgres"),
  host: z.string().default("localhost"),
  port: z.number().default(5432),
  database: z.string(),
  user: z.string().default("postgres"),
  password: z.string().optional(),
  password_file: z.string().optional(),
  all_databases: z.boolean().default(false), // Use pg_dumpall instead
});

export const MariadbJobSchema = BaseJobSchema.extend({
  type: z.literal("mariadb"),
  host: z.string().default("localhost"),
  port: z.number().default(3306),
  database: z.string(),
  user: z.string().default("root"),
  password: z.string().optional(),
  password_file: z.string().optional(),
  all_databases: z.boolean().default(false),
});

export const RedisJobSchema = BaseJobSchema.extend({
  type: z.literal("redis"),
  host: z.string().default("localhost"),
  port: z.number().default(6379),
  password: z.string().optional(),
  password_file: z.string().optional(),
  rdb_path: z.string().optional(),
});

export const JobConfigSchema = z.discriminatedUnion("type", [
  FolderJobSchema,
  PostgresJobSchema,
  MariadbJobSchema,
  RedisJobSchema,
]);

export type JobConfig = z.infer<typeof JobConfigSchema>;
export type FolderJob = z.infer<typeof FolderJobSchema>;
export type PostgresJob = z.infer<typeof PostgresJobSchema>;
export type MariadbJob = z.infer<typeof MariadbJobSchema>;
export type RedisJob = z.infer<typeof RedisJobSchema>;

export const WorkerGroupSchema = z.object({
  workers: z.array(z.string()),
  primary: z.string().optional(),
  failover_order: z.array(z.string()).optional(),
  quorum_size: z.number().min(1).default(2), // Votes needed for failover
});
export type WorkerGroup = z.infer<typeof WorkerGroupSchema>;

export const RedisConfigSchema = z.object({
  host: z.string().default("localhost"),
  port: z.number().default(6379),
  password: z.string().optional(),
  password_file: z.string().optional(),
  db: z.number().default(0),
});
export type RedisConfig = z.infer<typeof RedisConfigSchema>;

export const ConfigFileSchema = z.object({
  storage: z.record(z.string(), StorageConfigSchema),
  jobs: z.record(z.string(), JobConfigSchema),
  worker_groups: z.record(z.string(), WorkerGroupSchema).optional(),
  redis: RedisConfigSchema.optional(),
  restic: z.object({
    password: z.string().optional(),
    password_file: z.string().optional(),
    cache_dir: z.string().optional(),
  }).optional(),
});

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

export type NamedStorage = StorageConfig & {
  name: string;
};

export type NamedJob = JobConfig & {
  name: string;
};

export interface RuntimeConfig {
  storage: Map<string, StorageConfig>;
  jobs: Map<string, JobConfig>;
  workerGroups: Map<string, WorkerGroup>;
  redis?: RedisConfig;
  resticPassword?: string;
  resticCacheDir?: string;
}
