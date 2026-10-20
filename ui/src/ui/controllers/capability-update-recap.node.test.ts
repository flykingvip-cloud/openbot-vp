import { describe, expect, it, vi } from "vitest";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import {
  createInitialCapabilityUpdateRecapState,
  isEmployeeLanguageUpdateRecap,
  loadUpdateRecap,
} from "./capability-update-recap.ts";

describe("capability-update-recap controller", () => {
  it("loads employee-language update recaps", async () => {
    const state = createInitialCapabilityUpdateRecapState();
    state.gateway = {
      updateRecap: vi.fn(async () => ({
        capabilityId: "cap-1",
        recaps: [
          { id: "r1", at: 1, headline: "最近更新 · 优化了使用场景说明" },
          { id: "r2", at: 2, headline: "v1.2.3 internal note" },
        ],
      })),
    } as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    await loadUpdateRecap(state, "cap-1");

    expect(state.recaps).toEqual([{ id: "r1", at: 1, headline: "最近更新 · 优化了使用场景说明" }]);
  });

  it("detects non-employee update text", () => {
    expect(
      isEmployeeLanguageUpdateRecap({
        id: "r1",
        at: 1,
        headline: "最近更新 · 新增了常见任务示例",
      }),
    ).toBe(true);
    expect(
      isEmployeeLanguageUpdateRecap({
        id: "r2",
        at: 1,
        headline: "version rollback migration v1.2.3",
      }),
    ).toBe(false);
  });

  it("records employee-language errors", async () => {
    const state = createInitialCapabilityUpdateRecapState();
    state.gateway = {
      updateRecap: vi.fn(async () => {
        throw new Error("网络暂时不可用");
      }),
    } as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    await loadUpdateRecap(state, "cap-1");

    expect(state.error).toContain("网络暂时不可用");
    expect(state.recaps).toEqual([]);
  });
});
