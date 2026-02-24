import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Vitest configuration for Docker-based testing
 *
 * This config is used when running tests inside Docker containers
 * with real Redis and other services available via Docker DNS.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "tests/**/*.integration.test.ts",
    ],
    testTimeout: 60000,
    hookTimeout: 30000,
    // No global setup needed - services are already running in Docker
    reporters: ["default", "json"],
    outputFile: {
      json: "/app/test-results/worker-results.json",
    },
  },
  // Prevent Vite from transforming native Node modules
  server: {
    deps: {
      external: [/node_modules/],
    },
  },
});
