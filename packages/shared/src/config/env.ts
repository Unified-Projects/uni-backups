import { readFileSync, existsSync } from "fs";
import { z } from "zod";

const SECRET_ENV_KEYS = ["UNI_BACKUPS_RESTIC_PASSWORD"] as const;

export function readFileSecret(envKey: string): string | undefined {
  const fileEnvKey = `${envKey}_FILE`;
  const filePath = process.env[fileEnvKey];

  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`Secret file not found: ${filePath} (from ${fileEnvKey})`);
    }
    return readFileSync(filePath, "utf-8").trim();
  }

  return process.env[envKey];
}

export function readSecretFile(filePath: string): string {
  if (!existsSync(filePath)) {
    throw new Error(`Secret file not found: ${filePath}`);
  }
  return readFileSync(filePath, "utf-8").trim();
}

function resolveFileSecrets(): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = {};

  for (const key of SECRET_ENV_KEYS) {
    const value = readFileSecret(key);
    if (value !== undefined) {
      resolved[key] = value;
    }
  }

  return resolved;
}

function coerceBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
    if (["false", "0", "no", "off"].includes(normalized)) return false;
  }

  return Boolean(value);
}

const envSchema = z.object({
  UNI_BACKUPS_URL: z.string().default("http://localhost"),
  UNI_BACKUPS_CONFIG_FILE: z.string().optional(),
  UNI_BACKUPS_RESTIC_PASSWORD: z.string().optional(),
  UNI_BACKUPS_RESTIC_CACHE_DIR: z.string().default("/tmp/restic-cache"),
  UNI_BACKUPS_TEMP_DIR: z.string().default("/tmp/uni-backups"),
  UNI_BACKUPS_CORS_ENABLED: z
    .union([z.boolean(), z.string()])
    .transform(coerceBoolean)
    .default(true),
  UNI_BACKUPS_CORS_ORIGINS: z.string().optional(),
});

type EnvConfig = z.infer<typeof envSchema>;

function parseEnv(): EnvConfig {
  const fileSecrets = resolveFileSecrets();
  const merged = { ...process.env, ...fileSecrets };

  const filtered = Object.fromEntries(
    Object.entries(merged).filter(([_, v]) => v !== undefined)
  );

  return envSchema.parse(filtered);
}

let _env: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!_env) {
    _env = parseEnv();
  }
  return _env;
}

export function resetEnvCache(): void {
  _env = null;
}

export function getAppUrl(): string {
  return getEnv().UNI_BACKUPS_URL.replace(/\/$/, "");
}

export function getResticPassword(): string | undefined {
  return getEnv().UNI_BACKUPS_RESTIC_PASSWORD;
}

export function getResticCacheDir(): string {
  return getEnv().UNI_BACKUPS_RESTIC_CACHE_DIR;
}

export function getTempDir(): string {
  return getEnv().UNI_BACKUPS_TEMP_DIR;
}

export function getConfigFilePath(): string | undefined {
  return getEnv().UNI_BACKUPS_CONFIG_FILE;
}

export function getCorsConfig(): { enabled: boolean; origins: string[] } {
  const env = getEnv();
  const enabled = env.UNI_BACKUPS_CORS_ENABLED;

  const origins: string[] = [];
  origins.push(getAppUrl());
  origins.push("http://localhost");

  if (env.UNI_BACKUPS_CORS_ORIGINS) {
    const extra = env.UNI_BACKUPS_CORS_ORIGINS.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    origins.push(...extra);
  }

  return { enabled, origins: [...new Set(origins)] };
}
