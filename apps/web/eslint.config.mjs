import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextPlugin from "@next/eslint-plugin-next";

export default tseslint.config(
  // Ignore patterns
  {
    ignores: ["next-env.d.ts", ".next/**/*", "node_modules/**/*"],
  },

  // Base JavaScript rules
  js.configs.recommended,

  // Next.js core web vitals config
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
  },

  // TypeScript rules
  ...tseslint.configs.recommended,

  // Custom rules
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },

  // Config files - allow require() and module
  {
    files: ["*.config.js", "*.config.mjs"],
    languageOptions: {
      globals: {
        module: "readonly",
        require: "readonly",
      },
    },
  },

  // Test files - relaxed rules
  {
    files: ["e2e/**/*.ts", "e2e/**/*.spec.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
