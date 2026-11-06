import { expect, it } from "vitest";
import { declareCapability } from "./catalog.js";
it("does not claim cancellation for unaudited adapters", () => {
  const value = declareCapability("custom_mcp", true);
  expect(value).toMatchObject({
    executionKind: "unclassified",
    sideEffect: "unknown",
    cancellation: { request: "unknown", confirmation: "not_declared" },
    permission: { ownerOnly: true },
    automaticRetry: false,
  });
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
});
it("separates delegated tool return from task acceptance", () => {
  for (const id of ["lobster", "sessions_spawn"]) {
    const value = declareCapability(id);
    expect(value.executionKind).toBe("delegated_workflow");
    expect(value.completion).toEqual({ boundary: "tool_return", taskAcceptance: false });
  }
  expect(declareCapability("lobster").recovery).toEqual({
    owner: "external_workflow",
    token: "opaque_external",
  });
  expect(declareCapability("sessions_spawn").recovery.owner).toBe("unknown");
});
it("does not give lifecycle adapters completion authority", () => {
  expect(declareCapability("process")).toMatchObject({
    executionKind: "lifecycle_adapter",
    completion: { taskAcceptance: false },
    automaticRetry: false,
  });
});
