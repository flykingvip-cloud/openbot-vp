import { describe, expect, it } from "vitest";
import { buildWorkbenchCollaborationSpacesSnapshot } from "./workbench-collaboration-spaces-snapshot.ts";

describe("buildWorkbenchCollaborationSpacesSnapshot", () => {
  it("normalizes optional collaboration roster fields into stable workbench snapshots", () => {
    const result = buildWorkbenchCollaborationSpacesSnapshot({
      spaces: [
        {
          id: " alpha ",
          groupId: " group-alpha ",
          title: " 产品研发小组 ",
          ownerUserId: " user-1 ",
          purpose: " 战略研究 ",
          currentMission: " 明确三个月方向 ",
          collaborationMode: " discussion_driven ",
          systemInstructions: [" 新成员先介绍自己 ", " 重要结论沉淀为记忆 "],
          confidentialityTier: " internal ",
          operatingState: {
            groupId: " group-alpha ",
            groupProfile: {
              displayName: " 产品研发小组 ",
              purpose: " 战略研究 ",
              currentMission: " 明确三个月方向 ",
            },
            activeContext: {
              currentOperatingPhase: " decide ",
              currentMission: " 明确三个月方向 ",
            },
            onboardingStatus: {
              initialized: true,
            },
            collaborationPolicy: {
              maxVisibleBotRepliesPerRound: 3,
            },
          },
          members: {
            humans: [
              { userId: " u1 ", name: " Alice Zhang ", handle: " @alice ", status: "active" },
            ],
            bots: [
              {
                agentId: " bot-main ",
                name: " Aegis ",
                status: "active",
                runtimeStatus: "busy",
                lastActiveAt: " 2026-05-11T00:03:00.000Z ",
                currentTask: " 文章质量审核 ",
                openTaskCount: 2,
              },
            ],
          },
        },
      ],
    });

    expect(result).toEqual({
      archivedGroupIds: [],
      spaces: [
        {
          id: "alpha",
          groupId: "group-alpha",
          title: "产品研发小组",
          avatar: null,
          visibilityScope: null,
          ownerUserId: "user-1",
          purpose: "战略研究",
          currentMission: "明确三个月方向",
          collaborationMode: "discussion_driven",
          systemInstructions: ["新成员先介绍自己", "重要结论沉淀为记忆"],
          confidentialityTier: "internal",
          operatingState: {
            groupId: " group-alpha ",
            groupProfile: {
              displayName: " 产品研发小组 ",
              purpose: " 战略研究 ",
              currentMission: " 明确三个月方向 ",
            },
            activeContext: {
              currentOperatingPhase: " decide ",
              currentMission: " 明确三个月方向 ",
            },
            onboardingStatus: {
              initialized: true,
            },
            collaborationPolicy: {
              maxVisibleBotRepliesPerRound: 3,
            },
          },
          members: {
            humans: [
              {
                userId: "u1",
                name: "Alice Zhang",
                handle: "@alice",
                status: "active",
                presenceStatus: null,
                lastActiveAt: null,
              },
            ],
            bots: [
              {
                agentId: "bot-main",
                name: "Aegis",
                status: "active",
                runtimeStatus: "busy",
                lastActiveAt: "2026-05-11T00:03:00.000Z",
                currentTask: "文章质量审核",
                openTaskCount: 2,
              },
            ],
          },
          invites: {
            humans: [],
            bots: [],
          },
        },
      ],
    });
  });

  it("passes human presenceStatus through the workbench snapshot", () => {
    const result = buildWorkbenchCollaborationSpacesSnapshot({
      spaces: [
        {
          id: "space-presence",
          groupId: "space-presence",
          title: "产品体验官",
          members: {
            humans: [
              {
                userId: "ceo@x.com",
                name: "CEO",
                status: "active",
                presenceStatus: "online",
                lastActiveAt: "2026-08-04T14:00:00.000Z",
              },
            ],
            bots: [],
          },
        },
      ],
    });
    expect(result.spaces[0]?.members.humans[0]).toEqual({
      userId: "ceo@x.com",
      name: "CEO",
      handle: null,
      status: "active",
      presenceStatus: "online",
      lastActiveAt: "2026-08-04T14:00:00.000Z",
    });
  });

  it("drops invalid bridge entries without stable ids", () => {
    const result = buildWorkbenchCollaborationSpacesSnapshot({
      spaces: [
        { id: "   ", groupId: "   ", title: "broken" },
        { id: "ok", title: "usable" },
      ],
    });

    expect(result.spaces).toHaveLength(1);
    expect(result.spaces[0]).toMatchObject({
      id: "ok",
      groupId: null,
      title: "usable",
    });
  });

  it("passes archivedGroupIds through the workbench snapshot", () => {
    const result = buildWorkbenchCollaborationSpacesSnapshot({
      archivedGroupIds: ["space-b1e30f37"],
      spaces: [
        {
          id: "space-active",
          groupId: "space-active",
          title: "Aegis 产品开发",
          operatingState: {
            groupId: "space-active",
            groupProfile: { lifecycleStatus: "active" },
          },
          members: { humans: [], bots: [] },
        },
      ],
    });

    expect(result.archivedGroupIds).toEqual(["space-b1e30f37"]);
    expect(result.spaces).toHaveLength(1);
  });

  it("drops archived collaboration spaces from the workbench snapshot", () => {
    const result = buildWorkbenchCollaborationSpacesSnapshot({
      spaces: [
        {
          id: "space-b1e30f37",
          groupId: "space-b1e30f37",
          title: "产品研发小组",
          operatingState: {
            groupId: "space-b1e30f37",
            groupProfile: { lifecycleStatus: "archived" },
          },
          members: { humans: [], bots: [] },
        },
        {
          id: "space-active",
          groupId: "space-active",
          title: "Aegis 产品开发",
          operatingState: {
            groupId: "space-active",
            groupProfile: { lifecycleStatus: "active" },
          },
          members: { humans: [], bots: [] },
        },
      ],
    });

    expect(result.spaces).toHaveLength(1);
    expect(result.spaces[0]?.title).toBe("Aegis 产品开发");
  });
});
