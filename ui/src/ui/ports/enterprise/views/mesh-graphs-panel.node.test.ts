import { describe, expect, it } from "vitest";
import {
  applyMeshNodePositions,
  buildMeshGraphModel,
  filterMeshGraphModel,
  layoutMeshBipartiteGraph,
} from "./mesh-graphs-model.ts";

describe("buildMeshGraphModel", () => {
  it("uses real robot/group titles and member-roster edges", () => {
    const readModel = {
      currentTenantId: "acme",
      meshAgents: [
        {
          agentId: "main",
          name: "大白管家",
          sessionCount: 2,
          groupCount: 1,
          totalCost: 1.5,
          status: "online",
          governanceStatus: "normal",
        },
        {
          agentId: "bot-2",
          name: "市场助手",
          sessionCount: 0,
          groupCount: 0,
          totalCost: 0,
          status: "unknown",
          governanceStatus: "paused",
        },
      ],
      meshGroups: [
        {
          groupId: "0c12fbb4367fa6b0e828bf7c4e8de91a103e8735e6ed05b9a22a63276e1e3340",
          name: "0c12fbb4367fa6b0e828bf7c4e8de91a103e8735e6ed05b9a22a63276e1e3340",
          memberCount: 3,
          agentCount: 0,
          sessionCount: 0,
          totalCost: 0,
        },
      ],
    } as never;

    const model = buildMeshGraphModel({
      readModel,
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "per-sender",
        agents: [
          { id: "main", name: "大白管家" },
          { id: "bot-2", name: "市场助手" },
          { id: "bot-skill", name: "Skill孵化" },
        ],
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space-upbeyond",
            groupId: "grp-upbeyond",
            title: "upbeyond",
            members: {
              humans: [{ userId: "daniel@example.com", name: "UPBEYOND", status: "active" }],
              bots: [
                { agentId: "main", name: "大白管家", status: "active" },
                { agentId: "bot-2", name: "市场助手", status: "active" },
              ],
            },
          },
        ],
      } as never,
    });

    expect(model.agents.map((entry) => entry.name)).toEqual(["大白管家", "市场助手", "Skill孵化"]);
    expect(model.agents.find((entry) => entry.id === "bot-2")?.statusLabel).toBe("已暂停");
    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]?.name).toBe("upbeyond");
    expect(model.groups[0]?.humanCount).toBe(1);
    expect(model.groups[0]?.botCount).toBe(2);
    expect(model.edges).toEqual([
      {
        agentId: "main",
        agentName: "大白管家",
        groupId: "grp-upbeyond",
        groupName: "upbeyond",
      },
      {
        agentId: "bot-2",
        agentName: "市场助手",
        groupId: "grp-upbeyond",
        groupName: "upbeyond",
      },
    ]);
    expect(model.groups.every((entry) => !/^[0-9a-f]{40,}$/i.test(entry.name))).toBe(true);
  });

  it("shortens hash group ids when collaboration spaces are unavailable", () => {
    const hash = "0c12fbb4367fa6b0e828bf7c4e8de91a103e8735e6ed05b9a22a63276e1e3340";
    const model = buildMeshGraphModel({
      readModel: {
        currentTenantId: "acme",
        meshAgents: [],
        meshGroups: [
          {
            groupId: hash,
            name: hash,
            memberCount: 3,
            agentCount: 0,
            sessionCount: 0,
            totalCost: 0,
          },
        ],
      } as never,
      agentsList: null,
      collaborationSpacesResult: null,
    });

    expect(model.groups).toHaveLength(1);
    expect(model.groups[0]?.name).toBe("协作组 · 0c12fbb4…");
  });

  it("layouts a bipartite interactive canvas with member edges", () => {
    const model = buildMeshGraphModel({
      readModel: {
        currentTenantId: "acme",
        meshAgents: [],
        meshGroups: [],
      } as never,
      agentsList: {
        defaultId: "main",
        agents: [
          { id: "main", name: "大白管家" },
          { id: "bot-2", name: "市场助手" },
        ],
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space-a",
            groupId: "grp-a",
            title: "upbeyond",
            members: {
              humans: [],
              bots: [
                { agentId: "main", name: "大白管家", status: "active" },
                { agentId: "bot-2", name: "市场助手", status: "active" },
              ],
            },
          },
        ],
      } as never,
    });

    const layout = layoutMeshBipartiteGraph(model, { width: 700, height: 300 });
    expect(layout.nodes.filter((node) => node.kind === "agent")).toHaveLength(2);
    expect(layout.nodes.filter((node) => node.kind === "group")).toHaveLength(1);
    expect(layout.visibleEdgeCount).toBe(2);
    expect(layout.nodes.every((node) => node.x > 0 && node.y > 0)).toBe(true);
    const leftXs = layout.nodes.filter((node) => node.kind === "agent").map((node) => node.x);
    const rightXs = layout.nodes.filter((node) => node.kind === "group").map((node) => node.x);
    expect(Math.max(...leftXs)).toBeLessThan(Math.min(...rightXs));
  });

  it("filters by query with neighbor expansion and connected-only", () => {
    const model = buildMeshGraphModel({
      readModel: { currentTenantId: "acme", meshAgents: [], meshGroups: [] } as never,
      agentsList: {
        defaultId: "main",
        agents: [
          { id: "main", name: "大白管家" },
          { id: "orphan", name: "孤立机器人" },
        ],
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space-a",
            groupId: "grp-a",
            title: "upbeyond",
            members: {
              humans: [],
              bots: [{ agentId: "main", name: "大白管家", status: "active" }],
            },
          },
        ],
      } as never,
    });

    const byName = filterMeshGraphModel(model, {
      query: "upbeyond",
      kind: "all",
      connectedOnly: false,
    });
    expect(byName.groups.map((entry) => entry.name)).toEqual(["upbeyond"]);
    expect(byName.agents.map((entry) => entry.name)).toContain("大白管家");

    const connected = filterMeshGraphModel(model, {
      query: "",
      kind: "all",
      connectedOnly: true,
    });
    expect(connected.agents.map((entry) => entry.id)).toEqual(["main"]);
    expect(connected.agents.some((entry) => entry.id === "orphan")).toBe(false);

    const agentsOnly = filterMeshGraphModel(model, {
      query: "",
      kind: "agent",
      connectedOnly: false,
    });
    expect(agentsOnly.groups).toHaveLength(0);
    expect(agentsOnly.edges).toHaveLength(0);
  });

  it("applies dragged node positions and rebuilds edges", () => {
    const model = buildMeshGraphModel({
      readModel: { currentTenantId: "acme", meshAgents: [], meshGroups: [] } as never,
      agentsList: {
        defaultId: "main",
        agents: [{ id: "main", name: "大白管家" }],
      } as never,
      collaborationSpacesResult: {
        spaces: [
          {
            id: "space-a",
            groupId: "grp-a",
            title: "upbeyond",
            members: {
              humans: [],
              bots: [{ agentId: "main", name: "大白管家", status: "active" }],
            },
          },
        ],
      } as never,
    });
    const layout = layoutMeshBipartiteGraph(model);
    const moved = applyMeshNodePositions(layout, { "agent:main": { x: 200, y: 120 } }, model.edges);
    expect(moved.nodes.find((node) => node.id === "main")?.x).toBe(200);
    expect(moved.edges[0]?.y1).toBe(120);
  });
});
