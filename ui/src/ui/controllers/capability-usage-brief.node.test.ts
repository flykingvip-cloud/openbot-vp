import { describe, expect, it, vi } from "vitest";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import {
  createInitialCapabilityUsageBriefState,
  loadUsageBrief,
  shouldConfirmBeforeCapabilityChange,
} from "./capability-usage-brief.ts";

describe("capability-usage-brief controller", () => {
  it("loads the employee-layer usage brief", async () => {
    const state = createInitialCapabilityUsageBriefState();
    state.gateway = {
      usageBrief: vi.fn(async () => ({
        capabilityId: "cap-1",
        usage: {
          robots: [{ id: "robot-1", name: "销售助手" }],
          totalUsageCount: 12,
          lastUsedAt: 1_700_000_000_000,
        },
      })),
    } as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    await loadUsageBrief(state, "cap-1");

    expect(state.error).toBeNull();
    expect(state.usage?.robots[0]?.name).toBe("销售助手");
  });

  it("records an employee-language error when loading fails", async () => {
    const state = createInitialCapabilityUsageBriefState();
    state.gateway = {
      usageBrief: vi.fn(async () => {
        throw new Error("网络暂时不可用");
      }),
    } as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    await loadUsageBrief(state, "cap-1");

    expect(state.usage).toBeNull();
    expect(state.error).toContain("网络暂时不可用");
  });

  it("skips confirmation when no robots are using the capability", () => {
    expect(
      shouldConfirmBeforeCapabilityChange({
        robots: [],
        totalUsageCount: 0,
        lastUsedAt: null,
      }),
    ).toBe(false);
    expect(
      shouldConfirmBeforeCapabilityChange({
        robots: [{ id: "robot-1", name: "销售助手" }],
        totalUsageCount: 1,
        lastUsedAt: 1,
      }),
    ).toBe(true);
  });
});
