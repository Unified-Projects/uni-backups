/**
 * Vitest Configuration for Data Integrity Tests
 *
 * Configuration for running thorough data integrity verification tests:
 * - Full SHA256/MD5 checksum verification
 * - Byte-by-byte file comparison
 * - Large file handling (up to 1GB)
 * - Database backup/restore data verification
 * - Cross-storage integrity checks
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/integrity/**/*.test.ts"],

    exclude: ["**/node_modules/**", "**/dist/**"],

    testTimeout: 300000,
    hookTimeout: 180000,

    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,

    sequence: {
      concurrent: false,
    },

    retry: 0,

    environment: "node",

    setupFiles: ["./tests/setup/integrity-setup.ts"],

    reporters: process.env.CI
      ? ["default", "json", "html"]
      : ["verbose"],

    outputFile: {
      json: "./test-results/integrity-results.json",
      html: "./test-results/integrity-report.html",
    },

    coverage: {
      enabled: process.env.CI === "true",
      provider: "v8",
      reporter: ["text", "json", "html"],
      reportsDirectory: "./coverage/integrity",
      include: [
        "packages/shared/src/**/*.ts",
        "apps/api/src/services/**/*.ts",
        "apps/worker/src/services/**/*.ts",
      ],
      exclude: [
        "**/*.test.ts",
        "**/__tests__/**",
        "**/node_modules/**",
      ],
    },

    env: {
      TEST_TYPE: "integrity",
      NODE_ENV: "test",
    },
  },

  resolve: {
    alias: {
      "@uni-backups/shared": path.resolve(__dirname, "../packages/shared/src"),
      "@uni-backups/queue": path.resolve(__dirname, "../packages/queue/src"),
    },
  },
});
