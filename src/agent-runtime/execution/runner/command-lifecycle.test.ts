import { expect, it } from "vitest";
import { createCommandExecutionLifecycle } from "./command-lifecycle.js";

it("throws a tombstone error directing callers to createUnifiedExecutionLifecycle", () => {
  expect(() => createCommandExecutionLifecycle({ runId: "test" } as never)).toThrow(
    /Removed: createCommandExecutionLifecycle was retired in Phase 4/,
  );
  expect(() => createCommandExecutionLifecycle({ runId: "test" } as never)).toThrow(
    /createUnifiedExecutionLifecycle/,
  );
});
