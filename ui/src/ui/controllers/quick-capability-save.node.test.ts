import { describe, expect, it, vi } from "vitest";
import type { EmployeeCapabilityGateway } from "../capability/employee-capability/gateway-client.ts";
import type { CapabilitySummary } from "../capability/employee-capability/types.ts";
import {
  closeQuickSave,
  createInitialQuickCapabilitySaveState,
  openQuickSave,
  submitQuickSave,
  updateQuickSaveForm,
  type QuickCapabilitySaveState,
} from "./quick-capability-save.ts";

function capability(overrides: Partial<CapabilitySummary> = {}): CapabilitySummary {
  return {
    id: overrides.id ?? "cap-1",
    name: overrides.name ?? "合同审查",
    summary: overrides.summary ?? "识别合同中的风险条款",
    usageExamples: [],
    inputDescription: "",
    outputDescription: "",
    tags: [],
    category: "",
    avatar: null,
    health: "运行稳定",
    shareVisibility: "私有",
    maturity: null,
    attribution: {
      sourceRobot: { id: "robot-1", name: "销售助手" },
      sourceTaskSummary: "合同审查任务",
      firstFormedScenario: "首次在合同处理时形成",
      highFrequencyScenarios: [],
    },
    usage: { robots: [], totalUsageCount: 0, lastUsedAt: null },
    usageMetrics: { robotCount: 0, groupCount: 0, totalUsageCount: 0, lastUsedAt: null },
    recentUpdate: null,
    versionInfo: { currentVersion: "1.0.0", versionCount: 1, submittedVersion: null },
    isDraft: true,
    createdAt: 1,
    updatedAt: 1,
    enterpriseLifecycle: {
      stage: "draft",
      stageLabel: "资产草稿",
      nextStep: "补充信息后可共享或提交企业。",
    },
    ...overrides,
  };
}

function stateWithGateway(gateway: Partial<EmployeeCapabilityGateway>): QuickCapabilitySaveState {
  const state = createInitialQuickCapabilitySaveState();
  state.gateway = gateway as EmployeeCapabilityGateway;
  return state;
}

describe("quick-capability-save controller", () => {
  it("opens, updates, and closes the quick save state", () => {
    const state = createInitialQuickCapabilitySaveState();

    openQuickSave(state, {
      sourceAgentId: "robot-1",
      sourceContextId: "ctx-1",
      initialForm: { name: "合同审查" },
    });
    updateQuickSaveForm(state, { summary: "识别合同中的风险条款" });

    expect(state.open).toBe(true);
    expect(state.formData).toEqual({ name: "合同审查", summary: "识别合同中的风险条款" });
    closeQuickSave(state);
    expect(state.open).toBe(false);
  });

  it("submits a flat employee-layer payload and stores the returned draft", async () => {
    const quickSave = vi.fn(async () => ({ capability: capability() }));
    const state = stateWithGateway({ quickSave });
    openQuickSave(state, {
      sourceAgentId: "robot-1",
      sourceContextId: "ctx-1",
      patternHint: {
        sampleTaskDescription: "合同审查任务",
        firstFormedScenario: "首次在合同处理时形成",
      },
      initialForm: { name: " 合同审查 ", summary: " 识别合同中的风险条款 " },
    });

    const saved = await submitQuickSave(state);

    expect(quickSave).toHaveBeenCalledWith({
      name: "合同审查",
      summary: "识别合同中的风险条款",
      sourceAgentId: "robot-1",
      sourceContextId: "ctx-1",
      patternHint: {
        sampleTaskDescription: "合同审查任务",
        firstFormedScenario: "首次在合同处理时形成",
      },
    });
    expect(saved?.isDraft).toBe(true);
    expect(state.savedCapability?.id).toBe("cap-1");
    expect(state.open).toBe(false);
  });

  it("keeps the form data when submit fails", async () => {
    const state = stateWithGateway({
      quickSave: vi.fn(async () => {
        throw new Error("网络暂时不可用");
      }),
    });
    openQuickSave(state, {
      sourceAgentId: "robot-1",
      sourceContextId: "ctx-1",
      initialForm: { name: "合同审查", summary: "识别合同中的风险条款" },
    });

    await expect(submitQuickSave(state)).resolves.toBeNull();

    expect(state.error).toContain("网络暂时不可用");
    expect(state.formData).toEqual({ name: "合同审查", summary: "识别合同中的风险条款" });
    expect(state.open).toBe(true);
  });

  it("rejects missing required fields before calling the gateway", async () => {
    const quickSave = vi.fn();
    const state = stateWithGateway({ quickSave });
    openQuickSave(state, {
      sourceAgentId: "robot-1",
      sourceContextId: "ctx-1",
      initialForm: { name: "", summary: "识别合同中的风险条款" },
    });

    await expect(submitQuickSave(state)).resolves.toBeNull();

    expect(state.error).toBe("请填写名称");
    expect(quickSave).not.toHaveBeenCalled();
  });
});
