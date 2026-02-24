/**
 * Vitest configuration for System Integration Tests
 *
 * These tests require the full test infrastructure to be running:
 * docker compose -f tests/compose/services.yml --profile full up -d --wait
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/system/**/*.test.ts"],
    environment: "node",
    testTimeout: 300000,
    hookTimeout: 120000,
    globals: true,
    pool: "forks",
    maxWorkers: 1, // Run tests sequentially to avoid resource contention (replaces singleFork in vitest 4)
    fileParallelism: false,
    reporters: ["verbose"],
    outputFile: {
      json: "test-results/system-tests.json",
    },
    env: {
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
