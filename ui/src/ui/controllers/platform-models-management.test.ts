import { describe, expect, it, vi } from "vitest";
import {
  loadPlatformModelsManagementSnapshot,
  type PlatformModelsManagementState,
} from "./platform-models-management.ts";

function createState(
  overrides: Partial<PlatformModelsManagementState> = {},
): PlatformModelsManagementState {
  return {
    client: null,
    connected: false,
    modelsManagementLoading: false,
    modelsManagementError: null,
    modelsManagementSnapshot: null,
    platformModelsMode: "native",
    ...overrides,
  };
}

describe("loadPlatformModelsManagementSnapshot", () => {
  it("surfaces a clear error when gateway is disconnected instead of leaving loading forever", async () => {
    const state = createState({ client: null, connected: false });
    await loadPlatformModelsManagementSnapshot(state);
    expect(state.modelsManagementLoading).toBe(false);
    expect(state.modelsManagementSnapshot).toBeNull();
    expect(state.modelsManagementError).toMatch(/未连接|登录|会话/);
  });

  it("loads snapshot when connected", async () => {
    const request = vi.fn(async () => ({ mode: "native", models: [] }));
    const state = createState({
      connected: true,
      client: { request } as never,
    });
    await loadPlatformModelsManagementSnapshot(state);
    expect(request).toHaveBeenCalledWith("models.management.snapshot", {});
    expect(state.modelsManagementSnapshot).toEqual({ mode: "native", models: [] });
    expect(state.modelsManagementError).toBeNull();
    expect(state.modelsManagementLoading).toBe(false);
  });
});
