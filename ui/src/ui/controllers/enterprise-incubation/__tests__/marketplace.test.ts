import { describe, expect, it } from "vitest";
import type { SkillRecommendation } from "../../skill-recommendations.ts";
import {
  filterByTag,
  isTerminologyClean,
  markInstalled,
  type MarketplaceCapability,
  projectEmployeeRecommendations,
  projectToMarketplace,
  recommendationSourceLabel,
  searchByName,
  type AggregatedRecommendationInput,
} from "../marketplace.ts";

function makeRecommendation(overrides: Partial<SkillRecommendation> = {}): SkillRecommendation {
  return {
    skillId: "skill-1",
    name: "Test Skill",
    summary: "A test skill summary",
    category: "general",
    tags: ["tag-a", "tag-b"],
    source: "enterprise",
    sourceLabel: "企业资产库",
    health: "healthy",
    usageCount: 10,
    matchScore: 0.8,
    ...overrides,
  };
}

function makeCapability(overrides: Partial<MarketplaceCapability> = {}): MarketplaceCapability {
  return {
    skillId: "skill-1",
    name: "Test Capability",
    description: "A test description",
    scenarioTags: ["tag-a", "tag-b"],
    certified: false,
    installed: false,
    ...overrides,
  };
}

describe("projectToMarketplace", () => {
  it("maps fields correctly from SkillRecommendation", () => {
    const recs: SkillRecommendation[] = [
      makeRecommendation({
        skillId: "s1",
        name: "My Skill",
        summary: "Skill description",
        tags: ["automation", "chat"],
        source: "enterprise",
      }),
    ];

    const result = projectToMarketplace(recs);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      skillId: "s1",
      name: "My Skill",
      description: "Skill description",
      scenarioTags: ["automation", "chat"],
      certified: false,
      installed: false,
    });
  });

  it("caps scenarioTags at 3", () => {
    const recs: SkillRecommendation[] = [
      makeRecommendation({
        tags: ["tag1", "tag2", "tag3", "tag4", "tag5"],
      }),
    ];

    const result = projectToMarketplace(recs);

    expect(result[0].scenarioTags).toHaveLength(3);
    expect(result[0].scenarioTags).toEqual(["tag1", "tag2", "tag3"]);
  });

  it('source="shared" maps to certified=true', () => {
    const recs: SkillRecommendation[] = [makeRecommendation({ source: "shared" })];

    const result = projectToMarketplace(recs);

    expect(result[0].certified).toBe(true);
  });

  it('source!="shared" maps to certified=false', () => {
    const recs: SkillRecommendation[] = [makeRecommendation({ source: "enterprise" })];

    const result = projectToMarketplace(recs);

    expect(result[0].certified).toBe(false);
  });

  it("installed defaults to false", () => {
    const recs: SkillRecommendation[] = [makeRecommendation()];

    const result = projectToMarketplace(recs);

    expect(result[0].installed).toBe(false);
  });

  it("result objects only contain allowed fields (no runtime fields leak)", () => {
    const recs: SkillRecommendation[] = [
      makeRecommendation({
        health: "warning",
        usageCount: 999,
        matchScore: 0.95,
        category: "advanced",
        sourceLabel: "共享库",
      }),
    ];

    const result = projectToMarketplace(recs);
    const allowedKeys = [
      "skillId",
      "name",
      "description",
      "scenarioTags",
      "certified",
      "installed",
    ];
    const resultKeys = Object.keys(result[0]);

    expect(resultKeys.toSorted()).toEqual(allowedKeys.toSorted());
  });
});

describe("isTerminologyClean", () => {
  it("returns true for clean text", () => {
    expect(isTerminologyClean("这是一个正常的描述")).toBe(true);
    expect(isTerminologyClean("Hello world")).toBe(true);
  });

  it('returns false for text containing "workflow"', () => {
    expect(isTerminologyClean("This uses a workflow engine")).toBe(false);
  });

  it('returns false for text containing "schema"', () => {
    expect(isTerminologyClean("Define the schema first")).toBe(false);
  });

  it('returns false for text containing "prompt"', () => {
    expect(isTerminologyClean("Edit the prompt template")).toBe(false);
  });

  it('returns false for text containing "toolchain"', () => {
    expect(isTerminologyClean("Install the toolchain")).toBe(false);
  });

  it('returns false for text containing "dependency"', () => {
    expect(isTerminologyClean("Add a dependency")).toBe(false);
  });

  it('returns false for text containing "provider"', () => {
    expect(isTerminologyClean("Configure the provider")).toBe(false);
  });

  it('returns false for text containing "model"', () => {
    expect(isTerminologyClean("Select a model")).toBe(false);
  });

  it('returns false for text containing "routing"', () => {
    expect(isTerminologyClean("Set up routing rules")).toBe(false);
  });

  it('returns false for text containing "memory strategy"', () => {
    expect(isTerminologyClean("Configure memory strategy")).toBe(false);
  });

  it('returns false for text containing "execution policy"', () => {
    expect(isTerminologyClean("Define execution policy")).toBe(false);
  });

  it('returns false for text containing "capability governance"', () => {
    expect(isTerminologyClean("Apply capability governance")).toBe(false);
  });

  it('returns false for text containing "registry"', () => {
    expect(isTerminologyClean("Publish to registry")).toBe(false);
  });

  it('returns false for text containing "asset lifecycle"', () => {
    expect(isTerminologyClean("Manage asset lifecycle")).toBe(false);
  });

  it("is case-insensitive for English terms", () => {
    expect(isTerminologyClean("WORKFLOW engine")).toBe(false);
    expect(isTerminologyClean("Schema Definition")).toBe(false);
    expect(isTerminologyClean("PROMPT template")).toBe(false);
  });
});

describe("filterByTag", () => {
  const capabilities: MarketplaceCapability[] = [
    makeCapability({ skillId: "s1", scenarioTags: ["automation", "chat"] }),
    makeCapability({ skillId: "s2", scenarioTags: ["analytics"] }),
    makeCapability({ skillId: "s3", scenarioTags: ["automation", "reporting"] }),
  ];

  it("returns all capabilities when tag is null", () => {
    const result = filterByTag(capabilities, null);
    expect(result).toHaveLength(3);
    expect(result).toEqual(capabilities);
  });

  it("returns only capabilities matching the specified tag", () => {
    const result = filterByTag(capabilities, "automation");
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.scenarioTags.includes("automation"))).toBe(true);
  });

  it("returns empty array when no capabilities match", () => {
    const result = filterByTag(capabilities, "nonexistent");
    expect(result).toHaveLength(0);
  });
});

describe("searchByName", () => {
  const capabilities: MarketplaceCapability[] = [
    makeCapability({ skillId: "s1", name: "Test Capability" }),
    makeCapability({ skillId: "s2", name: "Another Tool" }),
    makeCapability({ skillId: "s3", name: "Testing Suite" }),
  ];

  it("returns all capabilities when query is empty", () => {
    const result = searchByName(capabilities, "");
    expect(result).toHaveLength(3);
  });

  it("returns all capabilities when query is whitespace only", () => {
    const result = searchByName(capabilities, "   ");
    expect(result).toHaveLength(3);
  });

  it('matches "test" to "Test Capability" (case-insensitive)', () => {
    const result = searchByName(capabilities, "test");
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.skillId)).toEqual(["s1", "s3"]);
  });

  it("returns empty array when no match found", () => {
    const result = searchByName(capabilities, "nonexistent");
    expect(result).toHaveLength(0);
  });

  it("works with a single character query", () => {
    const result = searchByName(capabilities, "A");
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((c) => c.name.toLowerCase().includes("a"))).toBe(true);
  });
});

describe("markInstalled", () => {
  const capabilities: MarketplaceCapability[] = [
    makeCapability({ skillId: "s1", installed: false }),
    makeCapability({ skillId: "s2", installed: false }),
    makeCapability({ skillId: "s3", installed: false }),
  ];

  it("marks matching skillIds as installed=true", () => {
    const installedIds = new Set(["s1", "s3"]);
    const result = markInstalled(capabilities, installedIds);

    expect(result[0].installed).toBe(true);
    expect(result[2].installed).toBe(true);
  });

  it("non-matching skillIds remain installed=false", () => {
    const installedIds = new Set(["s1", "s3"]);
    const result = markInstalled(capabilities, installedIds);

    expect(result[1].installed).toBe(false);
  });

  it("empty installedSkillIds set leaves all as installed=false", () => {
    const result = markInstalled(capabilities, new Set());
    expect(result.every((c) => !c.installed)).toBe(true);
  });

  it("installed=true iff skillId is in the set", () => {
    const installedIds = new Set(["s2"]);
    const result = markInstalled(capabilities, installedIds);

    for (const cap of result) {
      if (cap.skillId === "s2") {
        expect(cap.installed).toBe(true);
      } else {
        expect(cap.installed).toBe(false);
      }
    }
  });
});

function makeAggregated(
  overrides: Partial<AggregatedRecommendationInput> = {},
): AggregatedRecommendationInput {
  return {
    capability: {
      id: "cap-1",
      name: "客户摘要",
      summary: "整理客户对话",
      tags: ["客户", "摘要", "效率", "extra"],
    },
    reason: "示例理由",
    source: "platform_direct",
    ...overrides,
  };
}

describe("recommendationSourceLabel", () => {
  it("maps the three known sources to Chinese labels", () => {
    expect(recommendationSourceLabel("platform_direct")).toBe("平台直达");
    expect(recommendationSourceLabel("position_market")).toBe("企业推送");
    expect(recommendationSourceLabel("personal_shared")).toBe("共享推荐");
  });

  it("falls back to 共享推荐 for unknown sources", () => {
    expect(recommendationSourceLabel("mystery")).toBe("共享推荐");
    expect(recommendationSourceLabel("")).toBe("共享推荐");
  });
});

describe("projectEmployeeRecommendations", () => {
  it("attaches source + Chinese sourceLabel and projects fields", () => {
    const result = projectEmployeeRecommendations([makeAggregated({ source: "platform_direct" })]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      skillId: "cap-1",
      name: "客户摘要",
      description: "整理客户对话",
      source: "platform_direct",
      sourceLabel: "平台直达",
      installed: false,
    });
  });

  it("caps scenarioTags to the first 3", () => {
    const result = projectEmployeeRecommendations([makeAggregated()]);
    expect(result[0].scenarioTags).toHaveLength(3);
    expect(result[0].scenarioTags).toEqual(["客户", "摘要", "效率"]);
  });

  it("maps each source to its label", () => {
    const result = projectEmployeeRecommendations([
      makeAggregated({ capability: { id: "a", name: "A" }, source: "position_market" }),
      makeAggregated({ capability: { id: "b", name: "B" }, source: "personal_shared" }),
    ]);
    expect(result[0].sourceLabel).toBe("企业推送");
    expect(result[1].sourceLabel).toBe("共享推荐");
  });

  it("defaults unknown/missing source to personal_shared", () => {
    const result = projectEmployeeRecommendations([
      makeAggregated({ capability: { id: "c", name: "C" }, source: undefined }),
    ]);
    expect(result[0].source).toBe("personal_shared");
    expect(result[0].sourceLabel).toBe("共享推荐");
  });

  it("treats platform_direct as certified by default", () => {
    const result = projectEmployeeRecommendations([
      makeAggregated({ capability: { id: "d", name: "D" }, source: "platform_direct" }),
    ]);
    expect(result[0].certified).toBe(true);
  });

  it("prefers description over summary when both present", () => {
    const result = projectEmployeeRecommendations([
      makeAggregated({
        capability: { id: "e", name: "E", description: "显式描述", summary: "回退摘要" },
      }),
    ]);
    expect(result[0].description).toBe("显式描述");
  });
});
