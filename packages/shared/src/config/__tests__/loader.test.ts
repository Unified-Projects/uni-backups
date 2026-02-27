import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

describe("loader module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
    mockWriteFileSync.mockReset();
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("loadConfigFile", () => {
    it("loads config from YAML file", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/uni-backups/config.yml";

      const yamlContent = `
storage:
  local:
    type: local
    path: /backups
  s3:
    type: s3
    bucket: my-bucket
    region: eu-west-1
    access_key: AKIATEST
    secret_key: secretkey

jobs:
  daily-backup:
    type: folder
    source: /data
    storage: local
    schedule: "0 2 * * *"
    retention:
      daily: 7
      weekly: 4
  postgres-backup:
    type: postgres
    database: production
    storage: s3
    schedule: "0 3 * * *"

restic:
  restic_password: my-restic-password
  cache_dir: /var/cache/restic
`;

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(yamlContent);

      const { loadConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();
      const config = loadConfig();

      expect(config.storage.size).toBe(2);
      expect(config.storage.get("local")?.type).toBe("local");
      expect(config.storage.get("s3")?.type).toBe("s3");

      expect(config.jobs.size).toBe(2);
      const folderJob = config.jobs.get("daily-backup");
      expect(folderJob?.type).toBe("folder");
      if (folderJob?.type === "folder") {
        expect(folderJob.source).toBe("/data");
        expect(folderJob.schedule).toBe("0 2 * * *");
        expect(folderJob.retention?.daily).toBe(7);
      }

      expect(config.resticPassword).toBe("my-restic-password");
      expect(config.resticCacheDir).toBe("/var/cache/restic");
    });

    it("resolves _file references in YAML", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/uni-backups/config.yml";

      const yamlContent = `
storage:
  s3:
    type: s3
    bucket: backups
    access_key_file: /run/secrets/aws_key
    secret_key_file: /run/secrets/aws_secret

jobs:
  backup:
    type: folder
    source: /data
    storage: s3

restic:
  restic_password_file: /run/secrets/restic_password
`;

      mockExistsSync.mockImplementation((path) => {
        return [
          "/etc/uni-backups/config.yml",
          "/run/secrets/aws_key",
          "/run/secrets/aws_secret",
          "/run/secrets/restic_password",
        ].includes(path as string);
      });
      mockReadFileSync.mockImplementation((path) => {
        if (path === "/etc/uni-backups/config.yml") return yamlContent;
        if (path === "/run/secrets/aws_key") return "AWS_KEY_FROM_FILE";
        if (path === "/run/secrets/aws_secret") return "AWS_SECRET_FROM_FILE";
        if (path === "/run/secrets/restic_password") return "RESTIC_PASS_FROM_FILE";
        throw new Error("File not found");
      });

      const { loadConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();
      const config = loadConfig();

      const storage = config.storage.get("s3");
      if (storage?.type === "s3") {
        expect(storage.access_key).toBe("AWS_KEY_FROM_FILE");
        expect(storage.secret_key).toBe("AWS_SECRET_FROM_FILE");
      }
    });

    it("preserves SFTP key_file as a private key path", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/uni-backups/config.yml";

      const yamlContent = `
storage:
  sftp:
    type: sftp
    host: backup.example.com
    user: backup
    key_file: /home/backup/.ssh/id_ed25519
    path: /backups

jobs:
  backup:
    type: folder
    source: /data
    storage: sftp
`;

      mockExistsSync.mockImplementation((path) => path === "/etc/uni-backups/config.yml");
      mockReadFileSync.mockImplementation((path) => {
        if (path === "/etc/uni-backups/config.yml") return yamlContent;
        throw new Error(`Unexpected read: ${path}`);
      });

      const { loadConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();
      const config = loadConfig();

      const storage = config.storage.get("sftp");
      expect(storage?.type).toBe("sftp");
      if (storage?.type === "sftp") {
        expect(storage.key_file).toBe("/home/backup/.ssh/id_ed25519");
      }
    });

    it("warns when config file not found", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/nonexistent/config.yml";
      mockExistsSync.mockReturnValue(false);

      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const { loadConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();
      loadConfig();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Config file not found"));
      consoleSpy.mockRestore();
    });

    it("returns empty config when no config file specified", async () => {
      const { loadConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();
      const config = loadConfig();

      expect(config.storage.size).toBe(0);
      expect(config.jobs.size).toBe(0);
    });
  });

  describe("Redis config from env", () => {
    it("parses Redis config from env vars", async () => {
      process.env.REDIS_HOST = "redis.example.com";
      process.env.REDIS_PORT = "6380";
      process.env.REDIS_PASSWORD = "secret";
      process.env.REDIS_DB = "1";

      const { loadConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();
      const config = loadConfig();

      expect(config.redis?.host).toBe("redis.example.com");
      expect(config.redis?.port).toBe(6380);
      expect(config.redis?.password).toBe("secret");
      expect(config.redis?.db).toBe(1);
    });

    it("uses default Redis values", async () => {
      process.env.REDIS_HOST = "localhost";

      const { loadConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();
      const config = loadConfig();

      expect(config.redis?.host).toBe("localhost");
      expect(config.redis?.port).toBe(6379);
      expect(config.redis?.db).toBe(0);
    });
  });

  describe("getConfig singleton", () => {
    it("returns cached config", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/config.yml";

      const yamlContent = `
storage:
  local:
    type: local
    path: /backups
jobs:
  backup:
    type: folder
    source: /data
    storage: local
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(yamlContent);

      const { getConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();

      const first = getConfig();
      const second = getConfig();

      expect(first).toBe(second);
    });
  });

  describe("helper functions", () => {
    beforeEach(async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/config.yml";

      const yamlContent = `
storage:
  local:
    type: local
    path: /backups
jobs:
  backup:
    type: folder
    source: /data
    storage: local
`;
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(yamlContent);
    });

    it("getStorage returns storage by name", async () => {
      const { getStorage, resetConfigCache } = await import("../loader");
      resetConfigCache();

      const storage = getStorage("local");
      expect(storage?.type).toBe("local");
    });

    it("getStorage returns undefined for unknown name", async () => {
      const { getStorage, resetConfigCache } = await import("../loader");
      resetConfigCache();

      const storage = getStorage("unknown");
      expect(storage).toBeUndefined();
    });

    it("getJob returns job by name", async () => {
      const { getJob, resetConfigCache } = await import("../loader");
      resetConfigCache();

      const job = getJob("backup");
      expect(job?.type).toBe("folder");
    });

    it("getJob returns undefined for unknown name", async () => {
      const { getJob, resetConfigCache } = await import("../loader");
      resetConfigCache();

      const job = getJob("unknown");
      expect(job).toBeUndefined();
    });

    it("getAllStorage returns array of named storage", async () => {
      const { getAllStorage, resetConfigCache } = await import("../loader");
      resetConfigCache();

      const all = getAllStorage();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("local");
      expect(all[0].config.type).toBe("local");
    });

    it("getAllJobs returns array of named jobs", async () => {
      const { getAllJobs, resetConfigCache } = await import("../loader");
      resetConfigCache();

      const all = getAllJobs();
      expect(all).toHaveLength(1);
      expect(all[0].name).toBe("backup");
      expect(all[0].config.type).toBe("folder");
    });
  });

  describe("dirty flag and saveConfig", () => {
    it("isConfigDirty returns false on fresh load", async () => {
      const { isConfigDirty, resetConfigCache } = await import("../loader");
      resetConfigCache();

      expect(isConfigDirty()).toBe(false);
    });

    it("isConfigDirty returns true after addJob", async () => {
      const { addJob, isConfigDirty, resetConfigCache } = await import("../loader");
      resetConfigCache();

      addJob("new-job", { type: "folder", source: "/data", storage: "local" });

      expect(isConfigDirty()).toBe(true);
    });

    it("isConfigDirty returns true after updateJob", async () => {
      const { updateJob, isConfigDirty, resetConfigCache } = await import("../loader");
      resetConfigCache();

      updateJob("backup", { type: "folder", source: "/updated", storage: "local" });

      expect(isConfigDirty()).toBe(true);
    });

    it("isConfigDirty returns true after removeJob", async () => {
      const { removeJob, isConfigDirty, resetConfigCache } = await import("../loader");
      resetConfigCache();

      removeJob("backup");

      expect(isConfigDirty()).toBe(true);
    });

    it("saveConfig writes updated jobs to config file", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/uni-backups/config.yml";
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
storage:
  local:
    type: local
    path: /backups
jobs:
  backup:
    type: folder
    source: /data
    storage: local
`);

      const { addJob, saveConfig, isConfigDirty, resetConfigCache } = await import("../loader");
      resetConfigCache();

      addJob("new-job", { type: "folder", source: "/new", storage: "local" });
      expect(isConfigDirty()).toBe(true);

      saveConfig();

      expect(mockWriteFileSync).toHaveBeenCalledOnce();
      const [path, content] = mockWriteFileSync.mock.calls[0];
      expect(path).toBe("/etc/uni-backups/config.yml");
      expect(content).toContain("new-job");
      expect(content).toContain("backup");
      expect(content).toContain("local"); // storage section preserved
      expect(isConfigDirty()).toBe(false);
    });

    it("saveConfig throws when no config file is configured", async () => {
      delete process.env.UNI_BACKUPS_CONFIG_FILE;

      const { saveConfig, resetConfigCache } = await import("../loader");
      resetConfigCache();

      expect(() => saveConfig()).toThrow("No config file path configured");
    });

    it("saveConfig clears dirty flag on success", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/uni-backups/config.yml";
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("storage: {}\njobs: {}\n");

      const { addJob, saveConfig, isConfigDirty, resetConfigCache } = await import("../loader");
      resetConfigCache();

      addJob("job1", { type: "folder", source: "/x", storage: "local" });
      expect(isConfigDirty()).toBe(true);

      saveConfig();

      expect(isConfigDirty()).toBe(false);
    });
  });
});
