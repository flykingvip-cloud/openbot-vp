import { expect, it, vi } from "vitest";
import { createSupervisorWorkItemLifecycle } from "./supervisor-lifecycle.js";

it("throws a tombstone error directing callers to createUnifiedExecutionLifecycle", () => {
  expect(() => createSupervisorWorkItemLifecycle({ acquire: vi.fn() } as never)).toThrow(
    /Removed: createSupervisorWorkItemLifecycle was retired in Phase 4/,
  );
  expect(() => createSupervisorWorkItemLifecycle({ acquire: vi.fn() } as never)).toThrow(
    /createUnifiedExecutionLifecycle/,
  );
});
