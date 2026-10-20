import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".kiro/specs/execution-router-phase03/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
