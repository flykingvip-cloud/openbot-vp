import { describe, expect, it } from "vitest";
import {
  adaptCreatorAssets,
  adaptMeshAssets,
  buildCreatorRanking,
  buildMeshRanking,
} from "./runtime-adapter.ts";

describe("adaptCreatorAssets", () => {
  it("prefers creator-scoped robots and collaboration spaces over runtime placeholders", () => {
    const readModel = {
      authenticatedUser: "UPBEYOND",
      memberSummaries: [
        {
          user: "daniel.hhd@gmail.com",
          displayLabel: "UPBEYOND",
          membershipRole: "enterprise-admin",
          status: "active",
          seatTitle: "CEO",
          seatStatus: "occupied",
        },
      ],
      meshAgents: [],
      meshGroups: [],
      meshAnomalies: [],
    } as never;

    const agentsList = {
      defaultId: "main",
      mainKey: "main",
      scope: "per-sender",
      agents: [
        { id: "main", name: "大白管家" },
        { id: "bot", name: "高级秘书" },
        { id: "bot--agent", name: "高密度分析" },
        { id: "bot-2", name: "市场助手" },
        { id: "bot-skill", name: "Skill孵化" },
        { id: "panda", name: "熊猫学习" },
      ],
    } as never;

    const collaborationSpacesResult = {
      spaces: [
        {
          id: "grp-daniel-hhd-gmail-com-upbeyond",
          groupId: "grp-daniel-hhd-gmail-com-upbeyond",
          title: "upbeyond",
          ownerUserId: "daniel.hhd@gmail.com",
          members: {
            humans: [{ userId: "daniel.hhd@gmail.com", name: "UPBEYOND", status: "active" }],
            bots: [
              { agentId: "main", name: "大白管家", status: "active" },
              { agentId: "bot", name: "高级秘书", status: "active" },
              { agentId: "bot--agent", name: "高密度分析", status: "active" },
              { agentId: "bot-2", name: "市场助手", status: "active" },
              { agentId: "bot-skill", name: "Skill孵化", status: "active" },
              { agentId: "panda", name: "熊猫学习", status: "active" },
            ],
          },
          invites: { humans: [], bots: [] },
        },
        {
          id: "space-fef40e8a-0958-4c74-b557-069d7c333981",
          groupId: "space-fef40e8a-0958-4c74-b557-069d7c333981",
          title: "市场研究组",
          ownerUserId: "UPBEYOND",
          members: {
            humans: [{ userId: "UPBEYOND", name: "UPBEYOND", status: "active" }],
            bots: [{ agentId: "main", name: "大白管家", status: "active" }],
          },
          invites: { humans: [], bots: [] },
        },
      ],
    } as never;

    const assets = adaptCreatorAssets({
      readModel,
      agentsList,
      collaborationSpacesResult,
    });

    expect(assets.filter((entry) => entry.type === "bot").map((entry) => entry.name)).toEqual([
      "大白管家",
      "高级秘书",
      "高密度分析",
      "市场助手",
      "Skill孵化",
      "熊猫学习",
    ]);
    expect(assets.filter((entry) => entry.type === "group").map((entry) => entry.name)).toEqual([
      "upbeyond",
      "市场研究组",
    ]);
    expect(
      assets.every((entry) => !["Sales Assistant", "Customer Support Bot"].includes(entry.name)),
    ).toBe(true);
  });

  it("includes shared/team scoped agents when includeSharedTeamScopes is set", () => {
    const readModel = {
      authenticatedUser: "admin",
      memberSummaries: [],
      meshAgents: [],
      meshGroups: [],
      meshAnomalies: [],
    } as never;

    const agentsList = {
      defaultId: "shared-bot",
      agents: [
        { id: "personal", name: "个人助手", scope: "per-sender" },
        { id: "shared-bot", name: "共享助手", scope: "shared" },
        { id: "team-bot", name: "团队助手", scope: "team" },
      ],
    } as never;

    const filtered = adaptCreatorAssets({
      readModel,
      agentsList,
      collaborationSpacesResult: { spaces: [] },
    });
    expect(filtered.map((entry) => entry.id)).toEqual(["personal"]);

    const included = adaptCreatorAssets({
      readModel,
      agentsList,
      collaborationSpacesResult: { spaces: [] },
      includeSharedTeamScopes: true,
    });
    expect(included.map((entry) => entry.id).toSorted()).toEqual([
      "personal",
      "shared-bot",
      "team-bot",
    ]);
  });

  it("maps seat title to position and member display name to owner (not CEO/CEO)", () => {
    const readModel = {
      authenticatedUser: "UPBEYOND",
      memberSummaries: [
        {
          user: "daniel.hhd@gmail.com",
          displayLabel: "UPBEYOND",
          membershipRole: "enterprise-admin",
          status: "active",
          seatTitle: "CEO",
          seatStatus: "occupied",
        },
      ],
      meshAgents: [
        {
          agentId: "bot-2",
          name: "市场助手",
          creatorUser: "daniel.hhd@gmail.com",
          creatorLabel: "UPBEYOND",
          ownership: {
            positionId: "seat:CEO",
            positionLabel: "CEO",
            createdByUserId: "daniel.hhd@gmail.com",
            createdByUserLabel: "UPBEYOND",
            currentManagerUserId: "daniel.hhd@gmail.com",
            currentManagerLabel: "UPBEYOND",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          sessionCount: 0,
          totalCost: 0,
          errorCount: 0,
          governanceStatus: "normal",
          budgetStatus: "none",
        },
      ],
      meshGroups: [],
      meshAnomalies: [],
    } as never;

    const assets = adaptCreatorAssets({
      readModel,
      agentsList: {
        defaultId: "bot-2",
        mainKey: "bot-2",
        scope: "per-sender",
        agents: [
          {
            id: "bot-2",
            name: "市场助手",
            ownerId: "daniel.hhd@gmail.com",
            ownerName: "CEO",
          },
        ],
      } as never,
      collaborationSpacesResult: { spaces: [] } as never,
    });

    expect(assets).toHaveLength(1);
    expect(assets[0]?.name).toBe("市场助手");
    expect(assets[0]?.position).toBe("CEO");
    expect(assets[0]?.owner).toBe("UPBEYOND");
  });

  it("adaptMeshAssets projects robots and groups from readModel mesh rows", () => {
    const readModel = {
      authenticatedUser: "UPBEYOND",
      memberSummaries: [],
      meshAgents: [
        {
          agentId: "main",
          name: "大白管家",
          creatorUser: "daniel.hhd@gmail.com",
          creatorLabel: "UPBEYOND",
          ownership: {
            positionId: "seat:CEO",
            positionLabel: "CEO",
            createdByUserId: "daniel.hhd@gmail.com",
            createdByUserLabel: "UPBEYOND",
            currentManagerUserId: "daniel.hhd@gmail.com",
            currentManagerLabel: "UPBEYOND",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          sessionCount: 4,
          totalCost: 1.2,
          lifetimeCost: 9.5,
          errorCount: 0,
          governanceStatus: "normal",
          budgetStatus: "none",
        },
        {
          agentId: "bot-2",
          name: "市场助手",
          creatorUser: "daniel.hhd@gmail.com",
          creatorLabel: "UPBEYOND",
          ownership: {
            positionId: null,
            positionLabel: null,
            createdByUserId: "daniel.hhd@gmail.com",
            createdByUserLabel: "UPBEYOND",
            currentManagerUserId: "daniel.hhd@gmail.com",
            currentManagerLabel: "UPBEYOND",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
          sessionCount: 1,
          totalCost: 0.3,
          lifetimeCost: 2.1,
          errorCount: 0,
          governanceStatus: "normal",
          budgetStatus: "none",
        },
      ],
      meshGroups: [
        {
          groupId: "grp-upbeyond",
          name: "upbeyond",
          creatorUser: "daniel.hhd@gmail.com",
          creatorLabel: "UPBEYOND",
          ownership: {
            createdByUserId: "daniel.hhd@gmail.com",
            createdByUserLabel: "UPBEYOND",
          },
          memberCount: 2,
          sessionCount: 3,
          totalCost: 0.8,
          lifetimeCost: 3.3,
          incidentCount: 0,
          governanceStatus: "normal",
          budgetStatus: "none",
        },
      ],
      meshAnomalies: [],
    } as never;

    const assets = adaptMeshAssets(readModel);
    expect(assets.filter((entry) => entry.type === "bot").map((entry) => entry.name)).toEqual([
      "大白管家",
      "市场助手",
    ]);
    expect(assets.filter((entry) => entry.type === "group").map((entry) => entry.name)).toEqual([
      "upbeyond",
    ]);
    const main = assets.find((entry) => entry.id === "main");
    expect(main?.metrics.totalCost).toBe(1.2);
    expect(main?.metrics.lifetimeCost).toBe(9.5);

    const ranking = buildMeshRanking({ readModel, rankingType: "bot" });
    expect(ranking.items.map((entry) => entry.name)).toEqual(["大白管家", "市场助手"]);
  });

  it("buildCreatorRanking uses real robot names instead of gateway seed runtimes", () => {
    const readModel = {
      authenticatedUser: "UPBEYOND",
      memberSummaries: [
        {
          user: "daniel.hhd@gmail.com",
          displayLabel: "UPBEYOND",
          membershipRole: "enterprise-admin",
          status: "active",
          seatTitle: "CEO",
          seatStatus: "occupied",
        },
      ],
      meshAgents: [],
      meshGroups: [],
      meshAnomalies: [],
    } as never;

    const ranking = buildCreatorRanking({
      readModel,
      agentsList: {
        defaultId: "main",
        mainKey: "main",
        scope: "per-sender",
        agents: [
          { id: "main", name: "大白管家" },
          { id: "bot-2", name: "市场助手" },
        ],
      } as never,
      collaborationSpacesResult: { spaces: [] } as never,
      rankingType: "bot",
    });

    expect(ranking.items.map((entry) => entry.name)).toEqual(["大白管家", "市场助手"]);
    expect(ranking.items.every((entry) => !entry.name.includes("Runtime"))).toBe(true);
  });
});
