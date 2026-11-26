import { expect, it } from "vitest";
import { createExecutionLifecycle } from "./execution-lifecycle.js";

it("throws a tombstone error directing callers to createUnifiedExecutionLifecycle", () => {
  expect(() => createExecutionLifecycle("run", {} as never)).toThrow(
    /Removed: createExecutionLifecycle was retired in Phase 4/,
  );
  expect(() => createExecutionLifecycle("run", {} as never)).toThrow(
    /createUnifiedExecutionLifecycle/,
  );
});
