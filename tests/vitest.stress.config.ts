/**
 * Vitest Configuration for Stress and Endurance Tests
 *
 * Configuration for running stress tests that involve:
 * - High-concurrency API requests
 * - Worker endurance under sustained load
 * - Performance benchmarks for backup/restore operations
 * - Memory leak detection over extended operation
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/stress/**/*.test.ts"],

    exclude: ["**/node_modules/**", "**/dist/**"],

    testTimeout: 300000,
    hookTimeout: 120000,

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
      json: "./test-results/stress-results.json",
      html: "./test-results/stress-report.html",
    },

    coverage: {
      enabled: false,
    },

    env: {
      TEST_TYPE: "stress",
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
