import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "fs";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);

describe("env module", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    mockExistsSync.mockReset();
    mockReadFileSync.mockReset();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("readFileSecret", () => {
    it("reads secret from file when _FILE env var is set", async () => {
      process.env.UNI_BACKUPS_RESTIC_PASSWORD_FILE = "/run/secrets/password";
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("secret-from-file\n");

      const { readFileSecret } = await import("../env");
      const result = readFileSecret("UNI_BACKUPS_RESTIC_PASSWORD");

      expect(result).toBe("secret-from-file");
      expect(mockReadFileSync).toHaveBeenCalledWith("/run/secrets/password", "utf-8");
    });

    it("returns direct env value when _FILE is not set", async () => {
      process.env.UNI_BACKUPS_RESTIC_PASSWORD = "direct-password";

      const { readFileSecret } = await import("../env");
      const result = readFileSecret("UNI_BACKUPS_RESTIC_PASSWORD");

      expect(result).toBe("direct-password");
    });

    it("throws when _FILE points to non-existent file", async () => {
      process.env.UNI_BACKUPS_RESTIC_PASSWORD_FILE = "/nonexistent/path";
      mockExistsSync.mockReturnValue(false);

      const { readFileSecret } = await import("../env");

      expect(() => readFileSecret("UNI_BACKUPS_RESTIC_PASSWORD")).toThrow(
        "Secret file not found: /nonexistent/path"
      );
    });

    it("trims whitespace from file content", async () => {
      process.env.UNI_BACKUPS_RESTIC_PASSWORD_FILE = "/run/secrets/restic";
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("  secret-with-whitespace  \n");

      const { readFileSecret } = await import("../env");
      const result = readFileSecret("UNI_BACKUPS_RESTIC_PASSWORD");

      expect(result).toBe("secret-with-whitespace");
    });

    it("returns undefined when neither env var nor _FILE is set", async () => {
      const { readFileSecret } = await import("../env");
      const result = readFileSecret("UNI_BACKUPS_RESTIC_PASSWORD");

      expect(result).toBeUndefined();
    });
  });

  describe("readSecretFile", () => {
    it("reads and trims file content", async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("file-content\n");

      const { readSecretFile } = await import("../env");
      const result = readSecretFile("/path/to/secret");

      expect(result).toBe("file-content");
    });

    it("throws when file does not exist", async () => {
      mockExistsSync.mockReturnValue(false);

      const { readSecretFile } = await import("../env");

      expect(() => readSecretFile("/nonexistent")).toThrow(
        "Secret file not found: /nonexistent"
      );
    });
  });

  describe("getEnv", () => {
    it("returns cached env on subsequent calls", async () => {
      process.env.UNI_BACKUPS_URL = "http://test.local";

      const { getEnv } = await import("../env");
      const first = getEnv();
      const second = getEnv();

      expect(first).toBe(second);
    });

    it("parses default values", async () => {
      const { getEnv, resetEnvCache } = await import("../env");
      resetEnvCache();
      const env = getEnv();

      expect(env.UNI_BACKUPS_URL).toBe("http://localhost");
      expect(env.UNI_BACKUPS_RESTIC_CACHE_DIR).toBe("/tmp/restic-cache");
      expect(env.UNI_BACKUPS_TEMP_DIR).toBe("/tmp/uni-backups");
      expect(env.UNI_BACKUPS_CORS_ENABLED).toBe(true);
    });

    it("parses custom values", async () => {
      process.env.UNI_BACKUPS_URL = "https://backups.example.com";
      process.env.UNI_BACKUPS_RESTIC_PASSWORD = "my-password";
      process.env.UNI_BACKUPS_CORS_ENABLED = "false";

      const { getEnv, resetEnvCache } = await import("../env");
      resetEnvCache();
      const env = getEnv();

      expect(env.UNI_BACKUPS_URL).toBe("https://backups.example.com");
      expect(env.UNI_BACKUPS_RESTIC_PASSWORD).toBe("my-password");
      expect(env.UNI_BACKUPS_CORS_ENABLED).toBe(false);
    });

    it("resolves _FILE secrets during env parsing", async () => {
      process.env.UNI_BACKUPS_RESTIC_PASSWORD_FILE = "/run/secrets/restic";
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue("restic-password-from-file");

      const { getEnv, resetEnvCache } = await import("../env");
      resetEnvCache();
      const env = getEnv();

      expect(env.UNI_BACKUPS_RESTIC_PASSWORD).toBe("restic-password-from-file");
    });
  });

  describe("resetEnvCache", () => {
    it("clears cached env so next call re-parses", async () => {
      process.env.UNI_BACKUPS_URL = "http://first.local";

      const { getEnv, resetEnvCache } = await import("../env");
      const first = getEnv();

      process.env.UNI_BACKUPS_URL = "http://second.local";
      resetEnvCache();

      const second = getEnv();

      expect(first.UNI_BACKUPS_URL).toBe("http://first.local");
      expect(second.UNI_BACKUPS_URL).toBe("http://second.local");
    });
  });

  describe("getAppUrl", () => {
    it("returns URL without trailing slash", async () => {
      process.env.UNI_BACKUPS_URL = "http://example.com/";

      const { getAppUrl, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getAppUrl()).toBe("http://example.com");
    });

    it("preserves URL without trailing slash", async () => {
      process.env.UNI_BACKUPS_URL = "http://example.com";

      const { getAppUrl, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getAppUrl()).toBe("http://example.com");
    });
  });

  describe("getResticPassword", () => {
    it("returns undefined when not set", async () => {
      const { getResticPassword, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getResticPassword()).toBeUndefined();
    });

    it("returns password when set", async () => {
      process.env.UNI_BACKUPS_RESTIC_PASSWORD = "my-restic-password";

      const { getResticPassword, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getResticPassword()).toBe("my-restic-password");
    });
  });

  describe("getTempDir", () => {
    it("returns default temp dir", async () => {
      const { getTempDir, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getTempDir()).toBe("/tmp/uni-backups");
    });

    it("returns custom temp dir", async () => {
      process.env.UNI_BACKUPS_TEMP_DIR = "/custom/temp";

      const { getTempDir, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getTempDir()).toBe("/custom/temp");
    });
  });

  describe("getConfigFilePath", () => {
    it("returns undefined when not set", async () => {
      const { getConfigFilePath, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getConfigFilePath()).toBeUndefined();
    });

    it("returns path when set", async () => {
      process.env.UNI_BACKUPS_CONFIG_FILE = "/etc/uni-backups/config.yml";

      const { getConfigFilePath, resetEnvCache } = await import("../env");
      resetEnvCache();

      expect(getConfigFilePath()).toBe("/etc/uni-backups/config.yml");
    });
  });

  describe("getCorsConfig", () => {
    it("returns default CORS config", async () => {
      const { getCorsConfig, resetEnvCache } = await import("../env");
      resetEnvCache();

      const config = getCorsConfig();
      expect(config.enabled).toBe(true);
      expect(config.origins).toContain("http://localhost");
    });

    it("includes app URL in origins", async () => {
      process.env.UNI_BACKUPS_URL = "https://backups.example.com";

      const { getCorsConfig, resetEnvCache } = await import("../env");
      resetEnvCache();

      const config = getCorsConfig();
      expect(config.origins).toContain("https://backups.example.com");
    });

    it("adds custom CORS origins", async () => {
      process.env.UNI_BACKUPS_CORS_ORIGINS = "https://app1.com, https://app2.com";

      const { getCorsConfig, resetEnvCache } = await import("../env");
      resetEnvCache();

      const config = getCorsConfig();
      expect(config.origins).toContain("https://app1.com");
      expect(config.origins).toContain("https://app2.com");
    });

    it("deduplicates origins", async () => {
      process.env.UNI_BACKUPS_URL = "http://localhost";
      process.env.UNI_BACKUPS_CORS_ORIGINS = "http://localhost";

      const { getCorsConfig, resetEnvCache } = await import("../env");
      resetEnvCache();

      const config = getCorsConfig();
      const localhostCount = config.origins.filter((o) => o === "http://localhost").length;
      expect(localhostCount).toBe(1);
    });

    it("respects CORS disabled", async () => {
      process.env.UNI_BACKUPS_CORS_ENABLED = "false";

      const { getCorsConfig, resetEnvCache } = await import("../env");
      resetEnvCache();

      const config = getCorsConfig();
      expect(config.enabled).toBe(false);
    });
  });
});
