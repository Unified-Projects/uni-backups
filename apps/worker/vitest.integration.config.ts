import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.integration.test.ts", "src/**/*.integration.test.ts"],
    testTimeout: 120000,
    hookTimeout: 60000,
    // Run tests sequentially to avoid Redis conflicts between test files
    sequence: {
      concurrent: false,
    },
    fileParallelism: false,
  },
  // Prevent Vite from transforming native Node modules
  server: {
    deps: {
      external: [/node_modules/],
    },
  },
});
