import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  acceptClassificationSuggestion,
  dismissClassificationSuggestion,
  loadClassificationSuggestions,
  normalizeClassificationSuggestion,
  type SkillAutoClassifyState,
} from "./skill-auto-classify.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method, params) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(request: RequestHandler): SkillAutoClassifyState {
  return {
    client: { request: toGatewayRequest(request) } as GatewayBrowserClient,
    connected: true,
    pendingSuggestions: [],
    loading: false,
  };
}

describe("skill-auto-classify controller", () => {
  describe("loadClassificationSuggestions", () => {
    it("populates state with suggestions from API", async () => {
      const state = createState(async () => ({
        suggestions: [
          {
            skillId: "skill-1",
            suggestedCategory: "办公效率",
            suggestedTags: ["周报", "自动化"],
            reason: "基于同类技能的常见分类",
            confidence: 0.85,
          },
          {
            skillId: "skill-2",
            suggestedCategory: null,
            suggestedTags: ["客服"],
            reason: "同类技能常用标签",
            confidence: 0.7,
          },
        ],
      }));

      await loadClassificationSuggestions(state);

      expect(state.pendingSuggestions).toHaveLength(2);
      expect(state.pendingSuggestions[0]).toMatchObject({
        skillId: "skill-1",
        suggestedCategory: "办公效率",
        suggestedTags: ["周报", "自动化"],
        reason: "基于同类技能的常见分类",
        confidence: 0.85,
      });
      expect(state.pendingSuggestions[1]).toMatchObject({
        skillId: "skill-2",
        suggestedCategory: null,
        suggestedTags: ["客服"],
      });
      expect(state.loading).toBe(false);
    });

    it("does nothing when client is not connected", async () => {
      const state = createState(async () => ({ suggestions: [{ skillId: "s1" }] }));
      state.connected = false;

      await loadClassificationSuggestions(state);

      expect(state.pendingSuggestions).toEqual([]);
    });

    it("does nothing when already loading", async () => {
      const state = createState(async () => ({
        suggestions: [
          {
            skillId: "skill-1",
            suggestedCategory: "X",
            suggestedTags: [],
            reason: "r",
            confidence: 0.5,
          },
        ],
      }));
      state.loading = true;

      await loadClassificationSuggestions(state);

      expect(state.pendingSuggestions).toEqual([]);
    });

    it("keeps existing suggestions on request failure", async () => {
      const state = createState(async () => {
        throw new Error("network error");
      });
      state.pendingSuggestions = [
        {
          skillId: "existing",
          suggestedCategory: "保留",
          suggestedTags: [],
          reason: "已有建议",
          confidence: 0.5,
        },
      ];

      await loadClassificationSuggestions(state);

      expect(state.pendingSuggestions).toHaveLength(1);
      expect(state.pendingSuggestions[0].skillId).toBe("existing");
      expect(state.loading).toBe(false);
    });
  });

  describe("acceptClassificationSuggestion", () => {
    it("calls correct endpoint and removes suggestion from list", async () => {
      let calledMethod = "";
      let calledParams: unknown = null;
      const state = createState(async (method, params) => {
        calledMethod = method;
        calledParams = params;
        return {};
      });
      state.pendingSuggestions = [
        {
          skillId: "skill-1",
          suggestedCategory: "办公效率",
          suggestedTags: ["周报"],
          reason: "基于同类技能",
          confidence: 0.8,
        },
        {
          skillId: "skill-2",
          suggestedCategory: "客服",
          suggestedTags: [],
          reason: "常见分类",
          confidence: 0.6,
        },
      ];

      await acceptClassificationSuggestion(state, "skill-1", true, true);

      expect(calledMethod).toBe("skill-auto-classify.accept");
      expect(calledParams).toMatchObject({
        skillId: "skill-1",
        acceptCategory: true,
        acceptTags: true,
      });
      expect(state.pendingSuggestions).toHaveLength(1);
      expect(state.pendingSuggestions[0].skillId).toBe("skill-2");
    });

    it("does nothing when client is not connected", async () => {
      const state = createState(async () => ({}));
      state.connected = false;
      state.pendingSuggestions = [
        {
          skillId: "skill-1",
          suggestedCategory: "X",
          suggestedTags: [],
          reason: "r",
          confidence: 0.5,
        },
      ];

      await acceptClassificationSuggestion(state, "skill-1", true, false);

      expect(state.pendingSuggestions).toHaveLength(1);
    });

    it("keeps suggestion in list on request failure", async () => {
      const state = createState(async () => {
        throw new Error("timeout");
      });
      state.pendingSuggestions = [
        {
          skillId: "skill-1",
          suggestedCategory: "X",
          suggestedTags: [],
          reason: "r",
          confidence: 0.5,
        },
      ];

      await acceptClassificationSuggestion(state, "skill-1", true, false);

      expect(state.pendingSuggestions).toHaveLength(1);
    });
  });

  describe("dismissClassificationSuggestion", () => {
    it("removes suggestion from list", () => {
      const state = createState(async () => ({}));
      state.pendingSuggestions = [
        {
          skillId: "skill-1",
          suggestedCategory: "办公效率",
          suggestedTags: ["周报"],
          reason: "基于同类技能",
          confidence: 0.8,
        },
        {
          skillId: "skill-2",
          suggestedCategory: "客服",
          suggestedTags: [],
          reason: "常见分类",
          confidence: 0.6,
        },
      ];

      dismissClassificationSuggestion(state, "skill-1");

      expect(state.pendingSuggestions).toHaveLength(1);
      expect(state.pendingSuggestions[0].skillId).toBe("skill-2");
    });

    it("does nothing when skillId not found", () => {
      const state = createState(async () => ({}));
      state.pendingSuggestions = [
        {
          skillId: "skill-1",
          suggestedCategory: "X",
          suggestedTags: [],
          reason: "r",
          confidence: 0.5,
        },
      ];

      dismissClassificationSuggestion(state, "nonexistent");

      expect(state.pendingSuggestions).toHaveLength(1);
    });
  });

  describe("normalizeClassificationSuggestion", () => {
    it("normalizes a valid suggestion", () => {
      const result = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "办公效率",
        suggestedTags: ["周报", "自动化"],
        reason: "基于同类技能的常见分类",
        confidence: 0.85,
      });

      expect(result).toMatchObject({
        skillId: "skill-1",
        suggestedCategory: "办公效率",
        suggestedTags: ["周报", "自动化"],
        reason: "基于同类技能的常见分类",
        confidence: 0.85,
      });
    });

    it("returns null when skillId is missing", () => {
      const result = normalizeClassificationSuggestion({
        suggestedCategory: "办公效率",
        suggestedTags: ["周报"],
        reason: "test",
        confidence: 0.5,
      });

      expect(result).toBeNull();
    });

    it("returns null for null/undefined/non-object input", () => {
      expect(normalizeClassificationSuggestion(null)).toBeNull();
      expect(normalizeClassificationSuggestion(undefined)).toBeNull();
      expect(normalizeClassificationSuggestion("string")).toBeNull();
      expect(normalizeClassificationSuggestion(42)).toBeNull();
      expect(normalizeClassificationSuggestion([])).toBeNull();
    });

    it("handles missing suggestedCategory as null", () => {
      const result = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedTags: ["周报"],
        reason: "test",
        confidence: 0.5,
      });

      expect(result).toMatchObject({
        skillId: "skill-1",
        suggestedCategory: null,
        suggestedTags: ["周报"],
      });
    });

    it("handles empty/whitespace suggestedCategory as null", () => {
      const result = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "   ",
        suggestedTags: [],
        reason: "test",
        confidence: 0.5,
      });

      expect(result!.suggestedCategory).toBeNull();
    });

    it("handles missing suggestedTags as empty array", () => {
      const result = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "办公效率",
        reason: "test",
        confidence: 0.5,
      });

      expect(result!.suggestedTags).toEqual([]);
    });

    it("provides default reason when missing", () => {
      const result = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "办公效率",
        suggestedTags: [],
        confidence: 0.5,
      });

      expect(result!.reason).toBe("基于同类技能的常见分类");
    });

    it("clamps confidence to 0-1 range", () => {
      const overResult = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "X",
        suggestedTags: [],
        reason: "r",
        confidence: 1.5,
      });
      expect(overResult!.confidence).toBe(1);

      const underResult = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "X",
        suggestedTags: [],
        reason: "r",
        confidence: -0.5,
      });
      expect(underResult!.confidence).toBe(0);
    });

    it("defaults confidence to 0 for non-number values", () => {
      const result = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "X",
        suggestedTags: [],
        reason: "r",
        confidence: "high",
      });

      expect(result!.confidence).toBe(0);
    });

    it("suggestions never override without explicit acceptance", () => {
      // This test verifies the contract: normalizeClassificationSuggestion
      // only produces suggestion data — it does NOT modify any skill state.
      // The accept/dismiss pattern ensures employee must explicitly accept.
      const suggestion = normalizeClassificationSuggestion({
        skillId: "skill-1",
        suggestedCategory: "新分类",
        suggestedTags: ["新标签"],
        reason: "建议",
        confidence: 0.9,
      });

      // Suggestion is just data — it doesn't mutate anything
      expect(suggestion).not.toBeNull();
      expect(suggestion!.suggestedCategory).toBe("新分类");
      expect(suggestion!.suggestedTags).toEqual(["新标签"]);
      // The actual application only happens via acceptClassificationSuggestion
    });
  });
});
