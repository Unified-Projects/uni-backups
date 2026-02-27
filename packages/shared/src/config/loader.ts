import { existsSync, readFileSync, writeFileSync } from "fs";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  ConfigFileSchema,
  type StorageConfig,
  type JobConfig,
  type RuntimeConfig,
  type WorkerGroup,
  type RedisConfig,
} from "./types";
import { getConfigFilePath, getResticPassword, getResticCacheDir, readSecretFile } from "./env";

function loadConfigFile(filePath: string): {
  storage: Map<string, StorageConfig>;
  jobs: Map<string, JobConfig>;
  workerGroups: Map<string, WorkerGroup>;
  redis?: RedisConfig;
  resticPassword?: string;
  resticCacheDir?: string;
} {
  const content = readFileSync(filePath, "utf-8");
  const raw = parseYaml(content);

  const resolveSecrets = (obj: Record<string, unknown>): Record<string, unknown> => {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // key_file in SFTP storage is a path to the SSH private key itself,
      // not a pointer to another file that stores a secret.
      if (key.endsWith("_file") && key !== "key_file" && typeof value === "string") {
        const baseProp = key.slice(0, -5);
        resolved[baseProp] = readSecretFile(value);
      } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        resolved[key] = resolveSecrets(value as Record<string, unknown>);
      } else if (!obj[`${key}_file`]) {
        resolved[key] = value;
      }
    }

    return resolved;
  };

  const resolvedRaw = resolveSecrets(raw);
  const parsed = ConfigFileSchema.parse(resolvedRaw);

  const storage = new Map<string, StorageConfig>();
  for (const [name, config] of Object.entries(parsed.storage)) {
    storage.set(name, config);
  }

  const jobs = new Map<string, JobConfig>();
  for (const [name, config] of Object.entries(parsed.jobs)) {
    jobs.set(name, config);
  }

  const workerGroups = new Map<string, WorkerGroup>();
  if (parsed.worker_groups) {
    for (const [name, config] of Object.entries(parsed.worker_groups)) {
      workerGroups.set(name, config);
    }
  }

  const resticPassword = parsed.restic?.restic_password;
  const resticCacheDir = parsed.restic?.cache_dir;

  return { storage, jobs, workerGroups, redis: parsed.redis, resticPassword, resticCacheDir };
}

function parseRedisFromEnv(): RedisConfig | undefined {
  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT;
  const password = process.env.REDIS_PASSWORD;
  const passwordFile = process.env.REDIS_PASSWORD_FILE;
  const db = process.env.REDIS_DB;

  if (!host && !port && !password && !passwordFile) {
    return undefined;
  }

  return {
    host: host || "localhost",
    port: port ? parseInt(port, 10) : 6379,
    password: passwordFile ? readSecretFile(passwordFile) : password,
    db: db ? parseInt(db, 10) : 0,
  };
}

export function loadConfig(): RuntimeConfig {
  let storage = new Map<string, StorageConfig>();
  let jobs = new Map<string, JobConfig>();
  let workerGroups = new Map<string, WorkerGroup>();
  let redis: RedisConfig | undefined;
  let resticPassword: string | undefined;
  let resticCacheDir: string | undefined;

  const configFilePath = getConfigFilePath();
  if (configFilePath && existsSync(configFilePath)) {
    console.log(`Loading config from file: ${configFilePath}`);
    const fileConfig = loadConfigFile(configFilePath);
    storage = fileConfig.storage;
    jobs = fileConfig.jobs;
    workerGroups = fileConfig.workerGroups;
    redis = fileConfig.redis;
    resticPassword = fileConfig.resticPassword;
    resticCacheDir = fileConfig.resticCacheDir;
  } else if (configFilePath) {
    console.warn(`Config file not found: ${configFilePath}`);
  }

  const envRedis = parseRedisFromEnv();
  if (envRedis) {
    redis = envRedis;
  }

  const envResticPassword =
    process.env.UNI_BACKUPS_RESTIC_PASSWORD !== undefined ||
    process.env.UNI_BACKUPS_RESTIC_PASSWORD_FILE !== undefined
      ? getResticPassword()
      : undefined;

  if (envResticPassword !== undefined) {
    resticPassword = envResticPassword;
  }

  const envResticCacheDir =
    process.env.UNI_BACKUPS_RESTIC_CACHE_DIR !== undefined ? getResticCacheDir() : undefined;

  if (envResticCacheDir !== undefined) {
    resticCacheDir = envResticCacheDir;
  }

  if (!resticCacheDir) {
    resticCacheDir = getResticCacheDir();
  }

  return {
    storage,
    jobs,
    workerGroups,
    redis,
    resticPassword,
    resticCacheDir,
  };
}

let _config: RuntimeConfig | null = null;
let _dirty = false;

export function getConfig(): RuntimeConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function resetConfigCache(): void {
  _config = null;
}

export function getStorage(name: string): StorageConfig | undefined {
  return getConfig().storage.get(name);
}

export function getJob(name: string): JobConfig | undefined {
  return getConfig().jobs.get(name);
}

export function getAllStorage(): Array<{ name: string; config: StorageConfig }> {
  return Array.from(getConfig().storage.entries()).map(([name, config]) => ({
    name,
    config,
  }));
}

export function getAllJobs(): Array<{ name: string; config: JobConfig }> {
  return Array.from(getConfig().jobs.entries()).map(([name, config]) => ({
    name,
    config,
  }));
}

export function getWorkerGroup(name: string): WorkerGroup | undefined {
  return getConfig().workerGroups.get(name);
}

export function getAllWorkerGroups(): Array<{ name: string; config: WorkerGroup }> {
  return Array.from(getConfig().workerGroups.entries()).map(([name, config]) => ({
    name,
    config,
  }));
}

export function getRedisConfig(): RedisConfig | undefined {
  return getConfig().redis;
}

export function addJob(name: string, config: JobConfig): void {
  getConfig().jobs.set(name, config);
  _dirty = true;
}

export function updateJob(name: string, config: JobConfig): void {
  getConfig().jobs.set(name, config);
  _dirty = true;
}

export function removeJob(name: string): void {
  getConfig().jobs.delete(name);
  _dirty = true;
}

export function isConfigDirty(): boolean {
  return _dirty;
}

export function saveConfig(): void {
  const configFilePath = getConfigFilePath();
  if (!configFilePath) {
    throw new Error("No config file path configured (UNI_BACKUPS_CONFIG_FILE not set)");
  }

  let rawConfig: Record<string, unknown> = {};
  if (existsSync(configFilePath)) {
    rawConfig = parseYaml(readFileSync(configFilePath, "utf-8")) as Record<string, unknown>;
  }

  const jobsObj: Record<string, unknown> = {};
  for (const [name, job] of getConfig().jobs.entries()) {
    const jobData: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(job)) {
      if (v !== undefined && v !== null) jobData[k] = v;
    }
    jobsObj[name] = jobData;
  }
  rawConfig.jobs = jobsObj;

  writeFileSync(configFilePath, stringifyYaml(rawConfig, { lineWidth: 0 }), "utf-8");
  _dirty = false;
}
