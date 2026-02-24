/**
 * Vitest Configuration for Chaos Engineering Tests
 *
 * Configuration for running chaos engineering tests that involve:
 * - Killing workers mid-operation
 * - Network fault injection via Toxiproxy
 * - Storage failures and timeouts
 * - Database connection drops
 * - Concurrent operation conflicts
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["tests/chaos/**/*.chaos.test.ts"],

    exclude: ["**/node_modules/**", "**/dist/**"],

    // Long timeout for chaos tests (network failures, retries, etc.)
    testTimeout: 180000,
    hookTimeout: 120000,

    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,

    sequence: {
      concurrent: false,
    },

    retry: 1,

    bail: process.env.CI ? 0 : 1,

    environment: "node",

    globalSetup: ["./tests/setup/chaos-global-setup.ts"],
    globalTeardown: ["./tests/setup/chaos-global-teardown.ts"],

    setupFiles: ["./tests/setup/chaos-setup.ts"],

    reporters: process.env.CI
      ? ["default", "json", "html"]
      : ["verbose"],

    outputFile: {
      json: "./test-results/chaos-results.json",
      html: "./test-results/chaos-report.html",
    },

    coverage: {
      enabled: false,
    },

    env: {
      TEST_TYPE: "chaos",
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
