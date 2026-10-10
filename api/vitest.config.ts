import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // All test files share one Postgres database.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
