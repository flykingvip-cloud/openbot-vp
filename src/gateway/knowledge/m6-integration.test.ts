// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  knowledgeCognitiveBundle,
  knowledgeFeedList,
  knowledgeResolve,
  knowledgeContext,
} from "./router.js";

describe("M6 Feed / Universe / Agent Runtime integration", () => {
  it("lists standardized feed items for knowledge universe browse", async () => {
    const feed = await knowledgeFeedList(null);
    expect(feed.feedItems).toBeInstanceOf(Array);
    expect(feed.summary).toHaveProperty("feedItemCount");
    expect(feed.summary).toHaveProperty("enterpriseRestricted");
  });

  it("builds cognitive bundle with resolve/context consistency for agent runtime", async () => {
    const taskContext = {
      taskType: "analysis",
      agentId: "employee-agent",
      agentType: "employee-agent" as const,
    };
    const bundle = await knowledgeCognitiveBundle(null, {
      taskContext,
      query: "销售",
    });
    expect(bundle.profile.agentId).toBe("employee-agent");
    expect(bundle.resolved.objects.every((item) => item.accessState !== "restricted")).toBe(true);
    expect(bundle.context.primaryObjects.every((item) => item.accessState !== "restricted")).toBe(
      true,
    );
    expect(bundle.feedSummary.feedItemCount).toBeGreaterThanOrEqual(0);
  });

  it("keeps resolve and context router paths aligned for agent tasks", async () => {
    const taskContext = { taskType: "analysis", agentId: "employee-agent" };
    const resolved = await knowledgeResolve(null, { taskContext, query: "销售" });
    const context = await knowledgeContext(null, { taskContext, query: "销售" });
    if (resolved.objects.length > 0 && context.primaryObjects.length > 0) {
      expect(context.primaryObjects[0]?.id).toBe(resolved.objects[0]?.id);
    }
    expect(resolved.objects.every((item) => item.accessState !== "restricted")).toBe(true);
    expect(context.promptBlock).toContain("Do not call external CRM/ERP/Connector APIs directly");
  });
});
