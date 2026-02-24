/**
 * Vitest Configuration for Security Tests
 *
 * Configuration for running security tests that verify:
 * - Input validation and sanitization
 * - Path traversal prevention
 * - Shell injection prevention
 * - Credential exposure prevention
 * - Error message safety
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/security/**/*.test.ts"],

    exclude: ["**/node_modules/**", "**/dist/**"],

    testTimeout: 60000,
    hookTimeout: 30000,

    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,

    sequence: {
      concurrent: false,
    },

    retry: 0,

    environment: "node",

    reporters: process.env.CI
      ? ["default", "json", "html"]
      : ["verbose"],

    outputFile: {
      json: "./test-results/security-results.json",
      html: "./test-results/security-report.html",
    },

    coverage: {
      enabled: false,
    },

    env: {
      TEST_TYPE: "security",
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
