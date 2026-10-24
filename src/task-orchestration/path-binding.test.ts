import { afterEach, describe, expect, it } from "vitest";
import {
  ORCH_READONLY_PATH_PILOT_ENV,
  bindReadonlyPilotAction,
  clearReadonlyPathBindingsForTests,
  resolveReadonlyPilotPath,
} from "./path-binding.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

afterEach(() => {
  clearReadonlyPathBindingsForTests();
});

describe("WP-05 readonly path binding", () => {
  it("defaults to legacy and never unlocks live invoke", () => {
    expect(resolveReadonlyPilotPath({})).toBe("legacy");
    expect(resolveReadonlyPilotPath({ [ORCH_READONLY_PATH_PILOT_ENV]: "fabric" })).toBe("fabric");
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("binds once and refuses dual-exec for the same actionId", () => {
    const first = bindReadonlyPilotAction({
      surface: "memory",
      actionId: "act-1",
      env: {},
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      return;
    }
    expect(first.binding.path).toBe("legacy");
    const second = bindReadonlyPilotAction({
      surface: "memory",
      actionId: "act-1",
      env: {},
    });
    expect(second.ok).toBe(false);
    if (second.ok) {
      return;
    }
    expect(second.reason).toBe("dual_exec_refused");
  });

  it("rejects non-pilot surfaces", () => {
    const result = bindReadonlyPilotAction({
      surface: "browser",
      actionId: "act-browser",
      env: {},
    });
    expect(result.ok).toBe(false);
  });
});
