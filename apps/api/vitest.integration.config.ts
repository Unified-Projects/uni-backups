import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "dist/", "**/*.test.ts", "**/__tests__/**"],
    },
    testTimeout: 120000, // 2 minutes for integration tests with containers
    hookTimeout: 180000, // 3 minutes for setup/teardown
    pool: "forks", // Better isolation for Docker containers
    maxWorkers: 1, // Run tests sequentially to avoid port conflicts (replaces singleFork in vitest 4)
    fileParallelism: false,
    globalSetup: "./tests/global-setup.ts",
    globalTeardown: "./tests/global-teardown.ts",
  },
  // Prevent Vite from transforming native Node modules
  server: {
    deps: {
      external: [/node_modules/],
    },
  },
});
