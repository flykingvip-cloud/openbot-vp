import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  extractSkillContent,
  openSaveModal,
  saveSkill,
  type SkillLifecycleState,
} from "./skill-lifecycle.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method, params) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(request: RequestHandler): SkillLifecycleState {
  return {
    client: { request: toGatewayRequest(request) } as GatewayBrowserClient,
    connected: true,
    saveModalOpen: false,
    saveModalBusy: false,
    saveModalError: null,
    saveModalFormData: null,
    extractedPreview: null,
    sourceAgentId: null,
    sourceContextId: null,
  };
}

describe("skill lifecycle controller", () => {
  it("extracts a non-technical preview and pre-fills the quick save form", async () => {
    const state = createState(async () => ({
      suggestedName: "自动整理会议纪要",
      suggestedSummary: "从对话中整理行动项和结论",
      confidence: 0.84,
      runtimeDefinition: { prompts: ["hidden"] },
    }));

    await extractSkillContent(state, "agent-1", "context-1");

    expect(state.extractedPreview).toMatchObject({
      suggestedName: "自动整理会议纪要",
      suggestedSummary: "从对话中整理行动项和结论",
      confidence: 0.84,
    });
    expect(state.saveModalFormData).toMatchObject({
      name: "自动整理会议纪要",
      summary: "从对话中整理行动项和结论",
    });
    expect(state.saveModalFormData).not.toHaveProperty("assetType");
  });

  it("saves quick-save skills as draft with only employee-visible profile fields", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const state = createState(async (method, params) => {
      calls.push({ method, params });
      return { skillId: "skill-1" };
    });
    state.sourceContextId = "context-1";
    openSaveModal(state, "agent-1");

    const result = await saveSkill(
      state,
      {
        name: "合同审查",
        summary: "检查合同中的风险条款",
      },
      "agent-1",
    );

    expect(result).toEqual({ skillId: "skill-1" });
    expect(state.saveModalOpen).toBe(false);
    expect(calls).toEqual([
      {
        method: "skill-lifecycle.save",
        params: {
          sourceAgentId: "agent-1",
          contextId: "context-1",
          lifecycle: "draft",
          profile: {
            name: "合同审查",
            summary: "检查合同中的风险条款",
            usageExamples: [],
            inputDescription: "",
            outputDescription: "",
            tags: [],
            category: "",
            avatar: "",
            visibility: "private",
          },
        },
      },
    ]);
  });

  it("keeps the quick save form open and preserves text when validation fails", async () => {
    const state = createState(async () => ({ skillId: "skill-1" }));
    state.saveModalOpen = true;

    const result = await saveSkill(state, { name: "  ", summary: "  " }, "agent-1");

    expect(result).toBeNull();
    expect(state.saveModalOpen).toBe(true);
    expect(state.saveModalError).toBe("请填写技能名称和一句话描述");
  });

  it("lets the backend classify the asset and does not send a user-chosen type", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const state = createState(async (method, params) => {
      calls.push({ method, params });
      return { skillId: "skill-2" };
    });

    await saveSkill(
      state,
      {
        name: "网页检索",
        summary: "用 web_search 搜索公开网页",
        assetType: "knowledge",
      },
      "agent-1",
    );

    const saveCall = calls.find((entry) => entry.method === "skill-lifecycle.save");
    const params = saveCall?.params as
      | { profile?: { assetType?: string }; runtimeDefinition?: unknown }
      | undefined;
    expect(params?.profile?.assetType).toBeUndefined();
    expect(params?.runtimeDefinition).toBeUndefined();
  });
});
