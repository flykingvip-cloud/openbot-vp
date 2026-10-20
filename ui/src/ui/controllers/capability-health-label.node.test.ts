import { describe, expect, it, vi } from "vitest";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import {
  createInitialCapabilityHealthLabelState,
  projectHealthStatusToLabel,
  subscribeHealthLabel,
} from "./capability-health-label.ts";

describe("capability-health-label controller", () => {
  it("projects runtime health states to employee-language labels", () => {
    expect(projectHealthStatusToLabel("healthy")).toBe("运行稳定");
    expect(projectHealthStatusToLabel("warning")).toBe("偶尔异常");
    expect(projectHealthStatusToLabel("broken")).toBe("需要重新整理");
  });

  it("subscribes and stores initial employee-language labels", async () => {
    const state = createInitialCapabilityHealthLabelState();
    const onLabel = vi.fn();
    state.gateway = {
      healthLabelSubscribe: vi.fn(async () => ({
        subscriptionId: "sub-1",
        initialLabels: [
          { capabilityId: "cap-1", health: "运行稳定" },
          { capabilityId: "cap-2", health: "需要重新整理" },
        ],
      })),
    } as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    await subscribeHealthLabel(state, ["cap-1", "cap-2"], onLabel);

    expect(state.subscriptionId).toBe("sub-1");
    expect(state.labels).toEqual({
      "cap-1": "运行稳定",
      "cap-2": "需要重新整理",
    });
    expect(onLabel).toHaveBeenCalledWith("cap-1", "运行稳定");
    expect(onLabel).toHaveBeenCalledWith("cap-2", "需要重新整理");
  });

  it("records employee-language errors", async () => {
    const state = createInitialCapabilityHealthLabelState();
    state.gateway = {
      healthLabelSubscribe: vi.fn(async () => {
        throw new Error("网络暂时不可用");
      }),
    } as Partial<EmployeeCapabilityGateway> as EmployeeCapabilityGateway;

    await subscribeHealthLabel(state, ["cap-1"]);

    expect(state.error).toContain("网络暂时不可用");
    expect(state.subscriptionId).toBeNull();
  });
});
