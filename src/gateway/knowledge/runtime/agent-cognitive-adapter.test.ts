// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildKnowledgeSourceBundle } from "../empty-bundle.js";
import {
  buildKnowledgeAgentProfile,
  runKnowledgeResolveEngine,
} from "../resolve/resolve-engine.js";
import type { KnowledgeSourceBundle } from "../sources/types.js";
import type { DataCapabilityDescriptor, KnowledgeObject } from "../types.js";
import {
  buildAgentKnowledgeProfile,
  filterObjectsForAgentConsumption,
  resolveAgentKnowledgeType,
  stripUnauthorizedCapabilitySurface,
  UNAUTHORIZED_CAPABILITY_TITLE,
} from "./agent-cognitive-adapter.js";
import { buildIntelligentRelationshipGraph } from "./relationship-runtime.js";

describe("agent cognitive adapter M6", () => {
  it("defaults employee-agent type and honors taskContext override", () => {
    expect(resolveAgentKnowledgeType({ agentId: "agent-1" })).toBe("employee-agent");
    expect(
      resolveAgentKnowledgeType({
        taskContext: { taskType: "analysis", agentType: "platform-agent" },
      }),
    ).toBe("platform-agent");
  });

  it("filters restricted knowledge objects from agent consumption", () => {
    const objects: KnowledgeObject[] = [
      {
        id: "obj:1",
        title: "Open",
        source: "enterprise",
        kind: "document",
        summary: "ok",
        tags: [],
        updatedAt: Date.now(),
        accessState: "accessible",
      },
      {
        id: "obj:2",
        title: "Closed",
        source: "enterprise",
        kind: "document",
        summary: "no",
        tags: [],
        updatedAt: Date.now(),
        accessState: "restricted",
      },
    ];
    const filtered = filterObjectsForAgentConsumption(objects);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("obj:1");
  });

  it("strips unauthorized capability titles from cognitive graphs and keeps restricted filtering", async () => {
    const secretTitle = "机密客户能力";
    const grantedTitle = "已授权画像";
    const objects: KnowledgeObject[] = [
      {
        id: "obj:1",
        title: "Open",
        source: "enterprise",
        kind: "document",
        summary: "ok",
        tags: [],
        updatedAt: 1,
        accessState: "accessible",
      },
      {
        id: "obj:2",
        title: "Closed",
        source: "enterprise",
        kind: "document",
        summary: "no",
        tags: [],
        updatedAt: 1,
        accessState: "restricted",
      },
      {
        id: "obj:enterprise:handbook",
        title: "销售手册",
        source: "enterprise",
        kind: "document",
        summary: "handbook",
        tags: ["客户"],
        updatedAt: 1,
        relatedObjectIds: ["obj:data:secret-cap", "obj:data:open-cap"],
      },
      {
        id: "obj:data:secret-cap",
        title: secretTitle,
        source: "data",
        kind: "metric",
        summary: secretTitle,
        tags: ["客户"],
        updatedAt: 1,
      },
      {
        id: "obj:data:open-cap",
        title: grantedTitle,
        source: "data",
        kind: "metric",
        summary: grantedTitle,
        tags: ["画像"],
        updatedAt: 1,
      },
    ];
    const capabilities: DataCapabilityDescriptor[] = [
      {
        id: "secret-cap",
        title: secretTitle,
        summary: "secret",
        sourceSystems: [],
        scenarios: [],
        visibleAgents: ["spy-bot"],
        accessState: "requestable",
      },
      {
        id: "open-cap",
        title: grantedTitle,
        summary: "open",
        sourceSystems: [],
        scenarios: ["画像"],
        visibleAgents: ["sales-bot"],
        accessState: "granted",
      },
    ];
    const graph = buildIntelligentRelationshipGraph({
      objects,
      dataCapabilities: capabilities,
    }).graph;
    expect(JSON.stringify(graph)).toContain(secretTitle);

    const filtered = filterObjectsForAgentConsumption(objects);
    expect(filtered.map((item) => item.id)).not.toContain("obj:2");
    expect(filtered.map((item) => item.id)).toContain("obj:1");

    const stripped = stripUnauthorizedCapabilitySurface({
      graph,
      objects: filtered,
      capabilities,
    });
    const packed = JSON.stringify(stripped);
    expect(packed).not.toContain(secretTitle);
    expect(packed).toContain(grantedTitle);
    expect(packed).toContain(UNAUTHORIZED_CAPABILITY_TITLE);
    expect(stripped.objects.map((item) => item.id)).toContain("obj:1");
    expect(stripped.objects.map((item) => item.id)).not.toContain("obj:2");
    expect(stripped.objects.map((item) => item.id)).not.toContain("obj:data:secret-cap");
    expect(stripped.graph.nodes.some((node) => node.objectId === "obj:data:open-cap")).toBe(true);
    expect(stripped.graph.nodes.some((node) => node.title === "Closed")).toBe(true);

    const restrictedOnly = stripUnauthorizedCapabilitySurface({
      graph: { nodes: [], edges: [] },
      objects: objects.filter((item) => item.id === "obj:2"),
      capabilities,
    });
    expect(restrictedOnly.objects).toHaveLength(1);
    expect(restrictedOnly.objects[0]?.accessState).toBe("restricted");

    const bundle = buildKnowledgeSourceBundle({ objects, dataCapabilities: capabilities });
    const resolved = await runKnowledgeResolveEngine(null, {
      taskContext: { taskType: "analysis", agentId: "employee-agent" },
      bundle,
    });
    const resolvedPacked = JSON.stringify({
      objects: resolved.objects,
      graph: resolved.graph,
      recommendations: resolved.recommendations,
    });
    expect(resolvedPacked).not.toContain(secretTitle);
    expect(resolvedPacked).toContain(grantedTitle);
    expect(resolved.objects.every((item) => item.accessState !== "restricted")).toBe(true);
    expect(resolved.objects.some((item) => item.title === "Open")).toBe(true);
  });

  it("does not allow requested capabilities when none are granted", () => {
    const bundle = bundleWithCapabilities([
      capability("cap-open", "requestable"),
      capability("cap-closed", "pending"),
    ]);
    const requested = ["customer.profile", "cap-open", "cap-other"];
    const cognitive = buildAgentKnowledgeProfile({
      bundle,
      agentId: "employee-agent",
      agentType: "employee-agent",
      taskContext: { taskType: "analysis", requestedCapabilities: requested },
    });
    const resolved = buildKnowledgeAgentProfile({
      bundle,
      taskContext: {
        taskType: "analysis",
        agentId: "employee-agent",
        requestedCapabilities: requested,
      },
      selectedSources: ["personal"],
      intentConfidence: 0.6,
    });
    expect(cognitive.allowDataCapabilities).toEqual([]);
    expect(resolved.allowDataCapabilities).toEqual([]);

    const cognitiveDefault = buildAgentKnowledgeProfile({
      bundle,
      agentId: "employee-agent",
      agentType: "employee-agent",
    });
    const resolvedDefault = buildKnowledgeAgentProfile({
      bundle,
      taskContext: { taskType: "analysis" },
      selectedSources: ["personal"],
      intentConfidence: 0.6,
    });
    expect(cognitiveDefault.allowDataCapabilities).toEqual([]);
    expect(resolvedDefault.allowDataCapabilities).toEqual([]);
    expect(cognitiveDefault.allowDataCapabilities).not.toContain("customer.profile");
    expect(resolvedDefault.allowDataCapabilities).not.toContain("customer.profile");
  });

  it("keeps allowDataCapabilities to the intersection of granted and requested", () => {
    const bundle = bundleWithCapabilities([
      capability("cap-granted", "granted"),
      capability("cap-requestable", "requestable"),
    ]);
    const cognitive = buildAgentKnowledgeProfile({
      bundle,
      agentId: "employee-agent",
      agentType: "employee-agent",
      taskContext: {
        taskType: "analysis",
        requestedCapabilities: ["cap-granted", "customer.profile"],
      },
    });
    const resolved = buildKnowledgeAgentProfile({
      bundle,
      taskContext: {
        taskType: "analysis",
        requestedCapabilities: ["customer.profile", "cap-granted"],
      },
      selectedSources: ["data"],
      intentConfidence: 0.9,
    });
    expect(cognitive.allowDataCapabilities).toEqual(["cap-granted"]);
    expect(resolved.allowDataCapabilities).toEqual(["cap-granted"]);
  });
});

function capability(
  id: string,
  accessState: DataCapabilityDescriptor["accessState"],
): DataCapabilityDescriptor {
  return {
    id,
    title: id,
    summary: id,
    sourceSystems: [],
    scenarios: [],
    visibleAgents: [],
    accessState,
  };
}

function bundleWithCapabilities(
  dataCapabilities: DataCapabilityDescriptor[],
): KnowledgeSourceBundle {
  return buildKnowledgeSourceBundle({ objects: [], dataCapabilities });
}
