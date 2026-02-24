import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest configuration for integration tests
 *
 * This config runs integration tests that require real Redis.
 * These tests are run during Phase 2 of test-all.sh after Docker services are started.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    testTimeout: 60000,
    hookTimeout: 30000,
    // Run tests sequentially to avoid Redis race conditions
    pool: "forks",
    maxWorkers: 1, // Run tests sequentially to avoid Redis race conditions (replaces singleFork in vitest 4)
    fileParallelism: false,
    sequence: {
      concurrent: false,
    },
  },
  // Prevent Vite from transforming native Node modules
  server: {
    deps: {
      external: [/node_modules/],
    },
  },
});
