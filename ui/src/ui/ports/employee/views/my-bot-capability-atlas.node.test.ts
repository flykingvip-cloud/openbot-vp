import { describe, expect, it } from "vitest";
import {
  buildCapabilityRadar,
  capabilityNodesFromEvolution,
  capabilityNodesFromNamedUses,
  capabilityNodesFromRuntimeSkills,
  isCapturedDeliverable,
  isMasteredTopicMemoryKey,
  knowledgeNodesFromMastery,
  partitionRobotSkills,
  selectMasteredTopicKeys,
  standingMemoryTopics,
} from "./my-bot-capability-atlas.ts";

describe("partitionRobotSkills", () => {
  it("sends captured deliverables to outputs and keeps skills and knowledge apart", () => {
    const partitioned = partitionRobotSkills([
      {
        id: "skill_report",
        profile: {
          id: "skill_report",
          name: "季度经营复盘（3页 PPTX）",
          assetType: "knowledge",
          category: "对话成果",
          tags: ["ppt"],
        },
        deliverableArtifact: { previewKind: "file", filename: "review.pptx" },
      },
      {
        id: "skill_quote",
        profile: { id: "skill_quote", name: "报价助手", assetType: "workflow", category: "销售" },
        usageCount: 3,
        runtimeDefinition: { capabilities: ["research.web"] },
      },
      {
        id: "skill_pack",
        profile: { id: "skill_pack", name: "合同知识包", assetType: "knowledge", category: "知识" },
      },
    ]);

    expect(partitioned.outputs.map((item) => item.title)).toEqual(["季度经营复盘（3页 PPTX）"]);
    expect(partitioned.capabilities.map((item) => item.name)).toEqual(["报价助手"]);
    expect(partitioned.capabilities[0]?.domain).toBe("research");
    expect(partitioned.knowledge.map((item) => item.label)).toEqual(["合同知识包"]);
    expect(isCapturedDeliverable(partitioned)).toBe(false);
  });

  it("adds created and evolved skills that are not installed, and keeps deliverables out", () => {
    const nodes = capabilityNodesFromEvolution({
      agentId: "bot--agent",
      personalSkills: [
        {
          id: "skill_made",
          sourceRobot: { id: "bot--agent", name: "高密度分析" },
          profile: { id: "skill_made", name: "竞品扫描", assetType: "workflow" },
          versionCount: 2,
          usageCount: 4,
        },
        {
          id: "skill_other",
          sourceRobot: { id: "bot-2", name: "市场助手" },
          profile: { id: "skill_other", name: "别人的技能", assetType: "workflow" },
        },
        {
          id: "skill_doc",
          sourceRobot: { id: "bot--agent", name: "高密度分析" },
          profile: {
            id: "skill_doc",
            name: "季度经营复盘",
            assetType: "knowledge",
            category: "对话成果",
          },
          deliverableArtifact: { previewKind: "file", filename: "q.pptx" },
        },
      ],
      candidates: [
        {
          candidateId: "pc-browser",
          agentId: "bot--agent",
          status: "candidate",
          suggestedName: "稳定工作模式",
          sampleCount: 26,
          contract: { toolsRequired: ["browser"] },
        },
        {
          candidateId: "pc-wechat",
          agentId: "bot--agent",
          status: "candidate",
          suggestedName: "微信公众号成稿",
          suggestedSummary: "把文章写成公众号文案并发布",
          sampleCount: 12,
          contract: { toolsRequired: ["browser"] },
        },
        {
          candidateId: "pc-other",
          agentId: "bot-2",
          status: "candidate",
          suggestedName: "稳定工作模式",
          sampleCount: 9,
          contract: { toolsRequired: ["exec"] },
        },
      ],
      alreadyIncludedIds: new Set(),
    });
    expect(nodes.map((node) => node.name).toSorted()).toEqual(["微信公众号成稿", "竞品扫描"]);
    expect(nodes.find((node) => node.name === "竞品扫描")?.origin).toBe("evolved");
    expect(nodes.find((node) => node.name === "微信公众号成稿")?.origin).toBe("used");
    expect(nodes.find((node) => node.name === "微信公众号成稿")?.domain).toBe("content");
    const radar = buildCapabilityRadar(nodes);
    expect(radar.content).toBeGreaterThan(radar.research);
    expect(radar.content).toBeCloseTo(1);
    expect(radar.tools).toBe(0);
  });
});

describe("capabilityNodesFromNamedUses", () => {
  it("places a used wechat skill on the content axis and drops primitive tools", () => {
    const nodes = capabilityNodesFromNamedUses(
      [
        { name: "wechat-article", count: 8 },
        { name: "browser", count: 20 },
        { name: "exec", count: 4 },
      ],
      [
        {
          name: "wechat-article",
          skillKey: "wechat-article",
          description: "当用户要做微信公众号成稿、公众号排版时使用",
        },
      ],
    );
    expect(nodes.map((node) => node.name)).toEqual(["微信公众号成稿"]);
    expect(nodes[0]?.domain).toBe("content");
    expect(nodes[0]?.origin).toBe("used");
    expect(nodes[0]?.weight).toBe(8);
    const radar = buildCapabilityRadar(nodes);
    expect(radar.content).toBeCloseTo(1);
    expect(radar.tools).toBe(0);
  });
});

describe("knowledgeNodesFromMastery", () => {
  it("keeps standing memory and topic notes, and drops logs, reports, and addresses", () => {
    expect(isMasteredTopicMemoryKey("memory/wechat-content-strategy.md")).toBe(true);
    expect(isMasteredTopicMemoryKey("memory/2026-10-13.md")).toBe(false);
    expect(isMasteredTopicMemoryKey("memory/skill-analysis-report-2026-07-19.md")).toBe(false);
    expect(isMasteredTopicMemoryKey("MEMORY.md")).toBe(false);
    expect(
      selectMasteredTopicKeys([
        { key: "memory/2026-10-13.md", updatedAtMs: 9 },
        { key: "memory/wechat-content-strategy.md", updatedAtMs: 2 },
        { key: "memory/ai-watchlist.md", updatedAtMs: 3 },
      ]),
    ).toEqual(["memory/ai-watchlist.md", "memory/wechat-content-strategy.md"]);

    const standing = standingMemoryTopics(`# MEMORY.md

## Identity Baseline

- The registered email remains ada@example.com.

## User Relationship
`);
    expect(standing).toEqual(["身份", "和用户的关系"]);
    expect(standing.join(" ")).not.toContain("@");

    const nodes = knowledgeNodesFromMastery({
      standingMarkdown: "# MEMORY.md\n\n## Identity Baseline\n\n- secret\n",
      topics: [
        {
          key: "memory/wechat-content-strategy.md",
          markdown: "# 公众号文章选题方向与内容体系\n\n## 三大核心主题\n\n## 文章模板规范\n",
        },
        {
          key: "memory/2026-10-13.md",
          markdown: "# 日报\n",
        },
      ],
      atoms: [
        { id: "a1", summary: "公众号选题围绕 AI 应用", atomType: "strategy" },
        { id: "a2", summary: "contact ada@example.com", atomType: "preference" },
      ],
    });
    expect(nodes.map((node) => node.label)).toEqual([
      "长期记忆",
      "公众号文章选题方向与内容体系",
      "策略",
    ]);
    expect(nodes[0]?.documents).toEqual(["身份"]);
    expect(nodes[1]?.documents).toEqual(["三大核心主题", "文章模板规范"]);
    expect(nodes[2]?.documents).toEqual(["公众号选题围绕 AI 应用"]);
  });
});

describe("capabilityNodesFromRuntimeSkills", () => {
  it("keeps skills installed on this robot and drops the platform catalog", () => {
    const nodes = capabilityNodesFromRuntimeSkills([
      {
        name: "deep-research",
        skillKey: "deep-research",
        description: "Research a market",
        source: "openclaw-bundled",
        bundled: true,
        eligible: true,
        disabled: false,
      },
      {
        name: "feishu-doc",
        skillKey: "feishu-doc",
        description: "飞书文档",
        source: "openclaw-extra",
        bundled: false,
        eligible: true,
        disabled: false,
      },
      {
        name: "china-market-localization",
        skillKey: "china-market-localization",
        description: "中国市场本地化",
        source: "openclaw-workspace",
        bundled: false,
        eligible: true,
        disabled: false,
      },
    ]);
    expect(nodes.map((node) => node.name)).toEqual(["china-market-localization"]);
    expect(nodes[0]?.domain).toBe("research");
    expect(nodes[0]?.origin).toBe("installed");
  });
});
