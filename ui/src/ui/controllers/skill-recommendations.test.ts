import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  filterBySource,
  loadRecommendations,
  normalizeRecommendation,
  normalizeRecommendationList,
  type SkillRecommendation,
  type SkillRecommendationsState,
} from "./skill-recommendations.ts";

function createMockClient(response: unknown = {}): GatewayBrowserClient {
  return {
    request: vi.fn().mockResolvedValue(response),
  } as unknown as GatewayBrowserClient;
}

// Access the mocked `request` as a plain spy to avoid unbound-method lint on method references.
function requestMock(client: GatewayBrowserClient | null) {
  return (client as unknown as { request: ReturnType<typeof vi.fn> }).request;
}

function createState(overrides?: Partial<SkillRecommendationsState>): SkillRecommendationsState {
  return {
    client: createMockClient(),
    connected: true,
    loading: false,
    error: null,
    agentId: null,
    recommendations: [],
    ...overrides,
  };
}

describe("skill-recommendations controller", () => {
  describe("loadRecommendations", () => {
    it("calls skill-recommendations.list endpoint with agentId", async () => {
      const mockResponse = {
        items: [
          {
            skillId: "skill-1",
            name: "数据分析",
            summary: "自动分析数据并生成报告",
            category: "数据",
            tags: ["分析", "报告"],
            source: "enterprise",
            sourceLabel: "企业资产库",
            health: "healthy",
            usageCount: 42,
            matchScore: 0.85,
          },
        ],
      };
      const client = createMockClient(mockResponse);
      const state = createState({ client });

      await loadRecommendations(state, "agent-1");

      expect(requestMock(client)).toHaveBeenCalledWith("skill-recommendations.list", {
        agentId: "agent-1",
      });
    });

    it("populates state from gateway response", async () => {
      const mockResponse = {
        items: [
          {
            skillId: "skill-1",
            name: "数据分析",
            summary: "自动分析数据并生成报告",
            category: "数据",
            tags: ["分析", "报告"],
            source: "enterprise",
            sourceLabel: "企业资产库",
            health: "healthy",
            usageCount: 42,
            matchScore: 0.85,
          },
          {
            skillId: "skill-2",
            name: "文档整理",
            summary: "整理和归档文档",
            category: "办公",
            tags: ["文档"],
            source: "shared",
            sourceLabel: "产品组",
            health: "warning",
            usageCount: 10,
            matchScore: 0.6,
          },
        ],
      };
      const client = createMockClient(mockResponse);
      const state = createState({ client });

      await loadRecommendations(state, "agent-1");

      expect(state.recommendations).toHaveLength(2);
      expect(state.recommendations[0].skillId).toBe("skill-1");
      expect(state.recommendations[0].name).toBe("数据分析");
      expect(state.recommendations[0].source).toBe("enterprise");
      expect(state.recommendations[1].skillId).toBe("skill-2");
      expect(state.recommendations[1].source).toBe("shared");
      expect(state.agentId).toBe("agent-1");
      expect(state.loading).toBe(false);
    });

    it("does nothing when not connected", async () => {
      const client = createMockClient();
      const state = createState({ client, connected: false });

      await loadRecommendations(state, "agent-1");

      expect(requestMock(client)).not.toHaveBeenCalled();
      expect(state.recommendations).toEqual([]);
    });

    it("does nothing when already loading", async () => {
      const client = createMockClient();
      const state = createState({ client, loading: true });

      await loadRecommendations(state, "agent-1");

      expect(requestMock(client)).not.toHaveBeenCalled();
    });

    it("does nothing when client is null", async () => {
      const state = createState({ client: null });

      await loadRecommendations(state, "agent-1");

      expect(state.recommendations).toEqual([]);
    });

    it("sets state.error on request failure", async () => {
      const client = {
        request: vi.fn().mockRejectedValue(new Error("Network error")),
      } as unknown as GatewayBrowserClient;
      const state = createState({ client });

      await loadRecommendations(state, "agent-1");

      expect(state.error).toBe("Network error");
      expect(state.loading).toBe(false);
      expect(state.recommendations).toEqual([]);
    });
  });

  describe("normalizeRecommendation", () => {
    it("normalizes a complete recommendation", () => {
      const raw = {
        skillId: "skill-1",
        name: "数据分析",
        summary: "自动分析数据",
        category: "数据",
        tags: ["分析", "报告"],
        source: "enterprise",
        sourceLabel: "企业资产库",
        health: "healthy",
        usageCount: 42,
        matchScore: 0.85,
      };
      const result = normalizeRecommendation(raw);
      expect(result.skillId).toBe("skill-1");
      expect(result.name).toBe("数据分析");
      expect(result.summary).toBe("自动分析数据");
      expect(result.category).toBe("数据");
      expect(result.tags).toEqual(["分析", "报告"]);
      expect(result.source).toBe("enterprise");
      expect(result.sourceLabel).toBe("企业资产库");
      expect(result.health).toBe("healthy");
      expect(result.usageCount).toBe(42);
      expect(result.matchScore).toBe(0.85);
    });

    it("handles missing fields gracefully", () => {
      const result = normalizeRecommendation({});
      expect(result.skillId).toBe("");
      expect(result.name).toBe("");
      expect(result.summary).toBe("");
      expect(result.category).toBe("");
      expect(result.tags).toEqual([]);
      expect(result.source).toBe("enterprise");
      expect(result.sourceLabel).toBe("企业资产库");
      expect(result.health).toBe("healthy");
      expect(result.usageCount).toBe(0);
      expect(result.matchScore).toBe(0);
    });

    it("handles null input", () => {
      const result = normalizeRecommendation(null);
      expect(result.skillId).toBe("");
      expect(result.source).toBe("enterprise");
      expect(result.sourceLabel).toBe("企业资产库");
    });

    it("handles undefined input", () => {
      const result = normalizeRecommendation(undefined);
      expect(result.skillId).toBe("");
      expect(result.health).toBe("healthy");
    });

    it("clamps matchScore to 0-1 range", () => {
      expect(normalizeRecommendation({ matchScore: 1.5 }).matchScore).toBe(1);
      expect(normalizeRecommendation({ matchScore: -0.5 }).matchScore).toBe(0);
      expect(normalizeRecommendation({ matchScore: NaN }).matchScore).toBe(0);
      expect(normalizeRecommendation({ matchScore: Infinity }).matchScore).toBe(0);
    });

    it("normalizes health to valid values only", () => {
      expect(normalizeRecommendation({ health: "warning" }).health).toBe("warning");
      expect(normalizeRecommendation({ health: "broken" }).health).toBe("broken");
      expect(normalizeRecommendation({ health: "healthy" }).health).toBe("healthy");
      expect(normalizeRecommendation({ health: "invalid" }).health).toBe("healthy");
      expect(normalizeRecommendation({ health: null }).health).toBe("healthy");
    });

    it("normalizes source to enterprise or shared only", () => {
      expect(normalizeRecommendation({ source: "enterprise" }).source).toBe("enterprise");
      expect(normalizeRecommendation({ source: "shared" }).source).toBe("shared");
      expect(normalizeRecommendation({ source: "private" }).source).toBe("enterprise");
      expect(normalizeRecommendation({ source: "draft" }).source).toBe("enterprise");
      expect(normalizeRecommendation({ source: "reviewing" }).source).toBe("enterprise");
      expect(normalizeRecommendation({ source: "rejected" }).source).toBe("enterprise");
      expect(normalizeRecommendation({ source: "retired" }).source).toBe("enterprise");
    });

    it("defaults sourceLabel to 企业资产库 when empty", () => {
      expect(normalizeRecommendation({ sourceLabel: "" }).sourceLabel).toBe("企业资产库");
      expect(normalizeRecommendation({ sourceLabel: "  " }).sourceLabel).toBe("企业资产库");
      expect(normalizeRecommendation({ sourceLabel: null }).sourceLabel).toBe("企业资产库");
    });

    it("preserves non-empty sourceLabel", () => {
      expect(normalizeRecommendation({ sourceLabel: "产品组" }).sourceLabel).toBe("产品组");
    });

    it("handles non-numeric usageCount", () => {
      expect(normalizeRecommendation({ usageCount: "many" }).usageCount).toBe(0);
      expect(normalizeRecommendation({ usageCount: -5 }).usageCount).toBe(0);
      expect(normalizeRecommendation({ usageCount: NaN }).usageCount).toBe(0);
    });
  });

  describe("normalizeRecommendationList", () => {
    it("normalizes an array directly", () => {
      const raw = [
        { skillId: "s1", name: "A", source: "enterprise" },
        { skillId: "s2", name: "B", source: "shared" },
      ];
      const result = normalizeRecommendationList(raw);
      expect(result).toHaveLength(2);
      expect(result[0].skillId).toBe("s1");
      expect(result[1].skillId).toBe("s2");
    });

    it("normalizes from items property", () => {
      const raw = { items: [{ skillId: "s1", source: "enterprise" }] };
      const result = normalizeRecommendationList(raw);
      expect(result).toHaveLength(1);
      expect(result[0].skillId).toBe("s1");
    });

    it("normalizes from recommendations property", () => {
      const raw = { recommendations: [{ skillId: "s1", source: "shared" }] };
      const result = normalizeRecommendationList(raw);
      expect(result).toHaveLength(1);
      expect(result[0].source).toBe("shared");
    });

    it("returns empty array for null/undefined", () => {
      expect(normalizeRecommendationList(null)).toEqual([]);
      expect(normalizeRecommendationList(undefined)).toEqual([]);
    });

    it("returns empty array for non-array non-object", () => {
      expect(normalizeRecommendationList("hello")).toEqual([]);
      expect(normalizeRecommendationList(42)).toEqual([]);
    });

    it("all recommendations have source enterprise or shared (never private/draft/reviewing/rejected/retired)", () => {
      const raw = [
        { skillId: "s1", source: "enterprise" },
        { skillId: "s2", source: "shared" },
        { skillId: "s3", source: "private" },
        { skillId: "s4", source: "draft" },
        { skillId: "s5", source: "reviewing" },
        { skillId: "s6", source: "rejected" },
        { skillId: "s7", source: "retired" },
      ];
      const result = normalizeRecommendationList(raw);
      for (const rec of result) {
        expect(rec.source === "enterprise" || rec.source === "shared").toBe(true);
      }
    });
  });

  describe("filterBySource", () => {
    const recommendations: SkillRecommendation[] = [
      {
        skillId: "s1",
        name: "A",
        summary: "",
        category: "",
        tags: [],
        source: "enterprise",
        sourceLabel: "企业资产库",
        health: "healthy",
        usageCount: 10,
        matchScore: 0.9,
      },
      {
        skillId: "s2",
        name: "B",
        summary: "",
        category: "",
        tags: [],
        source: "shared",
        sourceLabel: "产品组",
        health: "healthy",
        usageCount: 5,
        matchScore: 0.7,
      },
      {
        skillId: "s3",
        name: "C",
        summary: "",
        category: "",
        tags: [],
        source: "enterprise",
        sourceLabel: "企业资产库",
        health: "warning",
        usageCount: 20,
        matchScore: 0.8,
      },
    ];

    it("filters by enterprise source", () => {
      const result = filterBySource(recommendations, "enterprise");
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.source === "enterprise")).toBe(true);
    });

    it("filters by shared source", () => {
      const result = filterBySource(recommendations, "shared");
      expect(result).toHaveLength(1);
      expect(result[0].skillId).toBe("s2");
    });

    it("returns empty array when no matches", () => {
      const enterpriseOnly: SkillRecommendation[] = [
        {
          skillId: "s1",
          name: "A",
          summary: "",
          category: "",
          tags: [],
          source: "enterprise",
          sourceLabel: "企业资产库",
          health: "healthy",
          usageCount: 10,
          matchScore: 0.9,
        },
      ];
      const result = filterBySource(enterpriseOnly, "shared");
      expect(result).toEqual([]);
    });

    it("returns empty array for empty input", () => {
      expect(filterBySource([], "enterprise")).toEqual([]);
      expect(filterBySource([], "shared")).toEqual([]);
    });
  });
});
