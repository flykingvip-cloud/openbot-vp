import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [".kiro/specs/execution-router-phase1/*.test.ts"],
    fileParallelism: false,
  },
});
