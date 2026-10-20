// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildDefaultKnowledgeObjects } from "./mock-graph.js";
import { classifyKnowledgeIntent } from "./resolve/intent-classifier.js";
import {
  buildKnowledgeAgentProfile,
  pinRequestedKnowledgeObjects,
  runKnowledgeContextEngine,
  runKnowledgeResolveEngine,
} from "./resolve/resolve-engine.js";
import { selectKnowledgeSources } from "./resolve/source-selector.js";
import { knowledgeContext, knowledgeResolve } from "./router.js";
import { loadKnowledgeSourceBundle } from "./source-bundle.js";

describe("knowledge resolve engine", () => {
  it("classifies analysis intent with enterprise and data sources", () => {
    const intent = classifyKnowledgeIntent({
      query: "客户成交率为什么下降",
      taskContext: { taskType: "analysis" },
    });
    expect(intent.intentType).toBe("analysis");
    expect(intent.suggestedSources).toContain("enterprise");
    expect(intent.suggestedSources).toContain("data");
    expect(intent.confidence).toBeGreaterThan(0.5);
  });

  it("classifies retrospective intent with personal and enterprise sources", () => {
    const intent = classifyKnowledgeIntent({
      query: "帮我整理这个项目复盘",
      taskContext: { taskType: "retrospective" },
    });
    expect(intent.intentType).toBe("retrospective");
    expect(intent.suggestedSources).toContain("personal");
    expect(intent.suggestedSources).toContain("enterprise");
  });

  it("selects sources from agent profile and task hints", async () => {
    const bundle = await loadKnowledgeSourceBundle(null);
    const taskContext = {
      taskType: "analysis",
      requestedSourceHints: ["enterprise" as const],
    };
    const intent = classifyKnowledgeIntent({ taskContext });
    const profile = buildKnowledgeAgentProfile({
      bundle,
      taskContext,
      selectedSources: intent.suggestedSources,
      intentConfidence: intent.confidence,
    });
    const selected = selectKnowledgeSources({ intent, taskContext, profile });
    expect(selected).toContain("enterprise");
  });

  it("resolves knowledge objects and recommendations for a task", async () => {
    const resolved = await runKnowledgeResolveEngine(null, {
      taskContext: { taskType: "analysis" },
      query: "销售",
    });
    expect(resolved.intent.intentType).toBe("analysis");
    expect(resolved.selectedSources.length).toBeGreaterThan(0);
    expect(resolved.profile.enabledSources).toEqual(resolved.selectedSources);
    expect(resolved.objects).toBeInstanceOf(Array);
    if (resolved.objects.length > 0) {
      expect(resolved.graph.nodes.length).toBeGreaterThan(0);
    }
  });

  it("pins requested knowledge object ids ahead of search results", () => {
    const objects = buildDefaultKnowledgeObjects();
    const target = objects[2];
    const pool = objects.slice(3, 6);
    const pinned = pinRequestedKnowledgeObjects(pool, [target.id], objects);
    expect(pinned[0]?.id).toBe(target.id);
    expect(pinned.length).toBeLessThanOrEqual(8);
  });

  it("builds agent context with prompt block and relationship groups", async () => {
    const context = await runKnowledgeContextEngine(null, {
      taskContext: { taskType: "general", agentId: "employee-agent" },
      query: "项目",
    });
    expect(context.primaryObjects).toBeInstanceOf(Array);
    expect(context.evidence).toBeInstanceOf(Array);
    expect(context.recommendedAgents).toBeInstanceOf(Array);
    expect(context.recommendedOwners).toBeInstanceOf(Array);
    expect(context.promptBlock).toContain("Knowledge Universe context");
    expect(context.promptBlock).toContain("Do not call external CRM/ERP/Connector APIs directly");
  });

  it("keeps resolve and context router paths consistent", async () => {
    const taskContext = { taskType: "analysis", agentId: "employee-agent" };
    const resolved = await knowledgeResolve(null, { taskContext, query: "销售" });
    const context = await knowledgeContext(null, { taskContext, query: "销售" });
    expect(context.primaryObjects.map((item) => item.id)).toEqual(
      resolved.objects.slice(0, 3).map((item) => item.id),
    );
    expect(context.graph.nodes.length).toBe(resolved.graph.nodes.length);
    expect(resolved.profile.agentId).toBe("employee-agent");
  });
});
