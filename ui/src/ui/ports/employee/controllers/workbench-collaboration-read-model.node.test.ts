import { describe, expect, it } from "vitest";
import type { WorkbenchCollaborationSpaceSnapshot } from "../views/workbench-types.ts";
import { buildWorkbenchCollaborationReadModel } from "./workbench-collaboration-read-model.ts";

function createManagedSpace(
  overrides: Partial<WorkbenchCollaborationSpaceSnapshot>,
): WorkbenchCollaborationSpaceSnapshot {
  return {
    id: "space",
    groupId: "group",
    title: "title",
    members: {
      humans: [{ userId: "owner", name: null, handle: null, status: "active" }],
      bots: [],
    },
    invites: {
      humans: [],
      bots: [],
    },
    ...overrides,
  };
}

describe("buildWorkbenchCollaborationReadModel", () => {
  it("normalizes collaboration identity fields and sorts session keys by recency", () => {
    const result = buildWorkbenchCollaborationReadModel({
      teamSpaces: [
        {
          id: "alpha",
          key: "space:alpha",
          sessionKeys: ["space:alpha", "agent:bot-1:space:alpha"],
          kind: "space",
          badge: "GR",
          title: "产品研发小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 1,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
      ],
      sessionsResult: {
        sessions: [
          { key: "space:alpha", updatedAt: 10, kind: "group" },
          { key: "agent:bot-1:space:alpha", updatedAt: 20, kind: "group" },
        ],
      } as never,
    });

    expect(result.savedTeamCount).toBe(1);
    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.[0]).toMatchObject({
      selectionKey: "space:alpha",
      entityId: "alpha",
      groupId: "alpha",
    });
    expect(result.teamSpaces?.[0].sessionKeys).toEqual(["space:alpha"]);
  });

  it("orders spaces the current user created before spaces they only joined", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "joined-1",
            groupId: "joined-1",
            title: "他人群一",
            ownerUserId: "other-user",
            members: {
              humans: [{ userId: "me", name: null, handle: null, status: "active" }],
              bots: [],
            },
          }),
          createManagedSpace({
            id: "owned-1",
            groupId: "owned-1",
            title: "我建群一",
            ownerUserId: "me",
          }),
          createManagedSpace({
            id: "joined-2",
            groupId: "joined-2",
            title: "他人群二",
            ownerUserId: "other-user",
            members: {
              humans: [{ userId: "me", name: null, handle: null, status: "active" }],
              bots: [],
            },
          }),
          createManagedSpace({
            id: "owned-2",
            groupId: "owned-2",
            title: "我建群二",
            ownerUserId: "me",
          }),
        ],
      },
      teamSpaces: [],
      sessionsResult: {
        sessions: [
          { key: "space:joined-1", updatedAt: 1, kind: "group", groupId: "joined-1" },
          { key: "space:owned-1", updatedAt: 2, kind: "group", groupId: "owned-1" },
          { key: "space:joined-2", updatedAt: 3, kind: "group", groupId: "joined-2" },
          { key: "space:owned-2", updatedAt: 4, kind: "group", groupId: "owned-2" },
        ],
      } as never,
      currentUserId: "me",
    });

    // Owned groups first (stable incoming order), then joined groups (stable order).
    expect(result.teamSpaces?.map((entry) => entry.groupId)).toEqual([
      "owned-1",
      "owned-2",
      "joined-1",
      "joined-2",
    ]);
  });

  it("hides invite-only spaces from collaboration nav while keeping owned spaces", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "owned",
            groupId: "owned",
            title: "我的组",
            ownerUserId: "ceo-uuid",
          }),
          createManagedSpace({
            id: "invite-only",
            groupId: "grp-invite",
            title: "权变管理专家",
            ownerUserId: "other",
            members: {
              humans: [
                { userId: "other", name: null, handle: null, status: "active" },
                { userId: "daniel.hhd@gmail.com", name: null, handle: null, status: "invited" },
              ],
              bots: [],
            },
            invites: {
              humans: [
                { userId: "daniel.hhd@gmail.com", name: null, handle: null, status: "invited" },
              ],
              bots: [],
            },
          }),
        ],
      },
      teamSpaces: [],
      currentUserId: "ceo-uuid",
      currentUserEmail: "daniel.hhd@gmail.com",
    });
    expect(result.teamSpaces?.map((entry) => entry.groupId)).toEqual(["owned"]);
  });

  it("preserves incoming order when no current user id is provided", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({ id: "a", groupId: "a", title: "群A", ownerUserId: "me" }),
          createManagedSpace({ id: "b", groupId: "b", title: "群B", ownerUserId: "me" }),
        ],
      },
      teamSpaces: [],
      sessionsResult: {
        sessions: [
          { key: "space:a", updatedAt: 1, kind: "group", groupId: "a" },
          { key: "space:b", updatedAt: 2, kind: "group", groupId: "b" },
        ],
      } as never,
    });

    // No current user → ownership split disabled → incoming order preserved.
    expect(result.teamSpaces?.map((entry) => entry.groupId)).toEqual(["a", "b"]);
  });

  it("builds collaboration entries from spaces.list data and merges matched session history", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [createManagedSpace({ id: "beta", groupId: "group-beta", title: "市场研究组" })],
      },
      teamSpaces: [],
      sessionsResult: {
        sessions: [
          { key: "space:beta", updatedAt: 10, kind: "group", groupId: "group-beta" },
          { key: "agent:main:space:beta", updatedAt: 20, kind: "group", groupId: "group-beta" },
        ],
      } as never,
    });

    expect(result.savedTeamCount).toBe(1);
    expect(result.teamSpaces?.[0]).toMatchObject({
      key: "space:group-beta",
      selectionKey: "space:group-beta",
      entityId: "beta",
      groupId: "group-beta",
      title: "市场研究组",
    });
    expect(result.teamSpaces?.[0].sessionKeys).toEqual(["space:group-beta"]);
  });

  it("prefers collaboration group sessions over direct alias sessions for managed spaces", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "fef40e8a-0958-4c74-b557-069d7c333981",
            groupId: "space-fef40e8a-0958-4c74-b557-069d7c333981",
            title: "市场研究组",
          }),
        ],
      },
      teamSpaces: [],
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:space:space-fef40e8a-0958-4c74-b557-069d7c333981",
            updatedAt: 30,
            kind: "chat",
            chatType: "direct",
            groupId: "space-fef40e8a-0958-4c74-b557-069d7c333981",
          },
          {
            key: "agent:main:main:space:space-fef40e8a-0958-4c74-b557-069d7c333981",
            updatedAt: 20,
            kind: "group",
            chatType: "group",
            groupId: "space-fef40e8a-0958-4c74-b557-069d7c333981",
          },
          {
            key: "agent:bot-skill:main:space:space-fef40e8a-0958-4c74-b557-069d7c333981",
            updatedAt: 10,
            kind: "group",
            chatType: "group",
            groupId: "space-fef40e8a-0958-4c74-b557-069d7c333981",
          },
          {
            key: "space:fef40e8a-0958-4c74-b557-069d7c333981",
            updatedAt: 40,
            kind: "group",
            chatType: "group",
          },
        ],
      } as never,
    });

    expect(result.teamSpaces?.[0]?.sessionKeys).toEqual([
      "space:space-fef40e8a-0958-4c74-b557-069d7c333981",
    ]);
  });

  it("prefers a meaningful legacy title and restores metadata-bound collaboration history", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "fef40e8a-0958-4c74-b557-7f6fdc1c4e8d",
            groupId: "group-aegis",
            title: "space-fef40e8a-0958-4c74-b557-7f6fdc1c4e8d",
          }),
        ],
      },
      teamSpaces: [
        {
          id: "fef40e8a-0958-4c74-b557-7f6fdc1c4e8d",
          key: "space:fef40e8a-0958-4c74-b557-7f6fdc1c4e8d",
          selectionKey: "space:fef40e8a-0958-4c74-b557-7f6fdc1c4e8d",
          sessionKeys: ["space:fef40e8a-0958-4c74-b557-7f6fdc1c4e8d"],
          kind: "space",
          badge: "GR",
          title: "aegis",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 1,
          unreadCount: 0,
          activity: "active",
          saved: true,
          entityId: "fef40e8a-0958-4c74-b557-7f6fdc1c4e8d",
          groupId: "group-aegis",
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "space:fef40e8a-0958-4c74-b557-7f6fdc1c4e8d",
            updatedAt: 10,
            kind: "group",
          },
          {
            key: "agent:main:collaboration-history",
            updatedAt: 20,
            kind: "group",
            displayName: "aegis",
            collaborationGroupProfile: {
              groupId: "group-aegis",
            },
          },
        ],
      } as never,
    });

    expect(result.teamSpaces?.[0]).toMatchObject({
      key: "space:group-aegis",
      title: "aegis",
    });
    expect(result.teamSpaces?.[0].sessionKeys).toEqual(["space:group-aegis"]);
  });

  it("merges generated managed spaces back onto saved legacy groups via session context", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "fef40e8a-0958-4c74-b557-069d7c333981",
            groupId: "grp-aegis",
            title: "space-fef40e8a-0958-4c74-b557-069d7c333981",
          }),
        ],
      },
      teamSpaces: [
        {
          id: "legacy-aegis",
          key: "space:legacy-aegis",
          selectionKey: "space:legacy-aegis",
          sessionKeys: ["agent:main:collaboration-history"],
          kind: "space",
          badge: "GR",
          title: "aegis",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 1,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:collaboration-history",
            updatedAt: 20,
            kind: "group",
            displayName: "aegis",
            collaborationGroupProfile: {
              groupId: "grp-aegis",
            },
          },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.[0]).toMatchObject({
      key: "space:grp-aegis",
      title: "aegis",
    });
    expect(result.teamSpaces?.[0].sessionKeys).toEqual(["space:grp-aegis"]);
  });

  it("keeps unmatched legacy collaboration groups when spaces.list is incomplete", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [createManagedSpace({ id: "beta", groupId: "group-beta", title: "市场研究组" })],
      },
      teamSpaces: [
        {
          id: "alpha",
          key: "space:alpha",
          selectionKey: "space:alpha",
          sessionKeys: ["agent:main:space:alpha"],
          kind: "space",
          badge: "GR",
          title: "产品研发小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 30,
          unreadCount: 0,
          activity: "active",
          saved: true,
          entityId: "alpha",
          groupId: "group-alpha",
        },
      ],
      sessionsResult: {
        sessions: [
          { key: "agent:main:space:alpha", updatedAt: 30, kind: "group", groupId: "group-alpha" },
          { key: "space:beta", updatedAt: 20, kind: "group", groupId: "group-beta" },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.map((entry) => entry.title)).toEqual(["市场研究组"]);
  });

  it("does not re-admit non-member spaces via session fallback when spaces.list is over-broad", () => {
    const result = buildWorkbenchCollaborationReadModel({
      currentUserId: "ceo",
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "grp-mine",
            groupId: "grp-mine",
            title: "我的小组",
            ownerUserId: "ceo",
            members: {
              humans: [{ userId: "ceo", name: null, handle: null, status: "active" }],
              bots: [],
            },
          }),
          createManagedSpace({
            id: "grp-foreign",
            groupId: "grp-foreign",
            title: "他人小组",
            ownerUserId: "alice",
            members: {
              humans: [{ userId: "alice", name: null, handle: null, status: "active" }],
              bots: [],
            },
          }),
        ],
      },
      teamSpaces: [
        {
          id: "grp-foreign",
          key: "space:grp-foreign",
          selectionKey: "space:grp-foreign",
          sessionKeys: ["agent:main:space:grp-foreign"],
          kind: "space",
          badge: "GR",
          title: "他人小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 40,
          unreadCount: 0,
          activity: "active",
          saved: true,
          entityId: "grp-foreign",
          groupId: "grp-foreign",
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:space:grp-foreign",
            updatedAt: 40,
            kind: "group",
            groupId: "grp-foreign",
            displayName: "他人小组",
          },
          {
            key: "agent:main:space:grp-mine",
            updatedAt: 20,
            kind: "group",
            groupId: "grp-mine",
            displayName: "我的小组",
          },
        ],
      } as never,
    });

    expect(result.teamSpaces?.map((entry) => entry.title)).toEqual(["我的小组"]);
  });

  it("drops session fallbacks for archivedGroupIds returned by spaces.list", () => {
    const dissolvedGroupId = "space-b1e30f37-8edb-4860-9646-c8801fef2b49";
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({ id: "gamma", groupId: "group-gamma", title: "Aegis 产品开发" }),
        ],
        archivedGroupIds: [dissolvedGroupId],
      },
      teamSpaces: [
        {
          id: dissolvedGroupId,
          key: `agent:main:space:${dissolvedGroupId}`,
          selectionKey: `space:${dissolvedGroupId}`,
          sessionKeys: [`agent:main:space:${dissolvedGroupId}`],
          kind: "space",
          badge: "GR",
          title: "产品研发小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 30,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: `agent:main:space:${dissolvedGroupId}`,
            updatedAt: 30,
            kind: "group",
            groupId: dissolvedGroupId,
            displayName: "产品研发小组",
          },
          { key: "space:gamma", updatedAt: 20, kind: "group", groupId: "group-gamma" },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.[0]?.title).toBe("Aegis 产品开发");
  });

  it("drops archived managed spaces and session fallbacks after dissolve", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "beta",
            groupId: "group-beta",
            title: "市场研究组",
            operatingState: {
              groupId: "group-beta",
              groupProfile: { lifecycleStatus: "archived" },
            },
          }),
          createManagedSpace({
            id: "gamma",
            groupId: "group-gamma",
            title: "Aegis 产品开发",
          }),
        ],
      },
      teamSpaces: [
        {
          id: "alpha",
          key: "space:alpha",
          selectionKey: "space:alpha",
          sessionKeys: ["agent:main:space:alpha"],
          kind: "space",
          badge: "GR",
          title: "产品研发小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 30,
          unreadCount: 0,
          activity: "active",
          saved: true,
          entityId: "alpha",
          groupId: "group-alpha",
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:space:alpha",
            updatedAt: 30,
            kind: "group",
            groupId: "group-alpha",
            collaborationGroupProfile: {
              groupId: "group-alpha",
              lifecycleStatus: "archived",
            },
          },
          { key: "space:gamma", updatedAt: 20, kind: "group", groupId: "group-gamma" },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.map((entry) => entry.title)).toEqual(["Aegis 产品开发"]);
  });

  it("drops orphaned managed collaboration fallbacks after dissolve", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({ id: "gamma", groupId: "group-gamma", title: "Aegis 产品开发" }),
        ],
      },
      teamSpaces: [
        {
          id: "alpha",
          key: "space:alpha",
          selectionKey: "space:alpha",
          sessionKeys: ["agent:main:space:alpha"],
          kind: "space",
          badge: "GR",
          title: "产品研发小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 30,
          unreadCount: 0,
          activity: "active",
          saved: true,
          entityId: "alpha",
          groupId: "group-alpha",
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:space:alpha",
            updatedAt: 30,
            kind: "group",
            groupId: "group-alpha",
            collaborationGroupProfile: {
              groupId: "group-alpha",
            },
          },
          { key: "space:gamma", updatedAt: 20, kind: "group", groupId: "group-gamma" },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.map((entry) => entry.title)).toEqual(["Aegis 产品开发"]);
  });

  it("drops unmatched generated legacy aliases when authoritative collaboration spaces exist", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [createManagedSpace({ id: "beta", groupId: "group-beta", title: "市场研究组" })],
      },
      teamSpaces: [
        {
          id: "c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          key: "space:c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          selectionKey: "space:c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          sessionKeys: ["space:c5d1adb4-7477-4ae4-a98e-adcaa75daea5"],
          kind: "space",
          badge: "GR",
          title: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 30,
          unreadCount: 0,
          activity: "active",
          saved: true,
          entityId: "c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "space:c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
            updatedAt: 30,
            kind: "group",
            displayName: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          },
          { key: "space:beta", updatedAt: 20, kind: "group", groupId: "group-beta" },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.map((entry) => entry.title)).toEqual(["市场研究组"]);
  });

  it("drops generated empty managed spaces that have no real roster or meaningful history", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
            groupId: "c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
            title: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          }),
        ],
      },
      teamSpaces: [],
      sessionsResult: {
        sessions: [
          {
            key: "space:c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
            updatedAt: 30,
            kind: "group",
            displayName: "space-c5d1adb4-7477-4ae4-a98e-adcaa75daea5",
          },
        ],
      } as never,
    });

    expect(result.teamSpaces).toEqual([]);
  });

  it("drops a named empty shell after dissolve even when sessions still remember the title", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "grp-product-rd",
            groupId: "grp-469932872-qq-com-产品研发小组",
            title: "产品研发小组",
            ownerUserId: "30d71dfd-other",
            members: { humans: [], bots: [] },
            invites: { humans: [], bots: [] },
          }),
        ],
      },
      teamSpaces: [
        {
          id: "grp-product-rd",
          key: "space:grp-469932872-qq-com-产品研发小组",
          selectionKey: "space:grp-469932872-qq-com-产品研发小组",
          sessionKeys: ["agent:main:space:grp-469932872-qq-com-产品研发小组"],
          kind: "space",
          badge: "GR",
          title: "产品研发小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 30,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "agent:main:space:grp-469932872-qq-com-产品研发小组",
            updatedAt: 30,
            kind: "group",
            groupId: "grp-469932872-qq-com-产品研发小组",
            displayName: "产品研发小组",
          },
        ],
      } as never,
    });

    expect(result.teamSpaces).toEqual([]);
  });

  it("keeps a named space that still has pending bot invites even if the roster is empty", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "space:alpha",
            groupId: "grp-alpha",
            title: "产品研发小组",
            members: { humans: [], bots: [] },
            invites: {
              humans: [],
              bots: [{ agentId: "bot-owned", name: "我的机器人", status: "pending" }],
            },
          }),
        ],
      },
      teamSpaces: [],
      sessionsResult: {
        sessions: [
          { key: "space:alpha", updatedAt: 20, kind: "group", displayName: "产品研发小组" },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.[0]?.title).toBe("产品研发小组");
  });

  it("keeps generated managed spaces when they already have real roster members", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [
          createManagedSpace({
            id: "space-alpha",
            groupId: "space-alpha",
            title: "space-space-alpha",
            members: {
              humans: [{ userId: "u1", name: "Alice", handle: null, status: "active" }],
              bots: [],
            },
            invites: { humans: [], bots: [] },
          }),
        ],
      },
      teamSpaces: [],
      sessionsResult: null,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.[0]?.key).toBe("space:space-alpha");
  });

  it("excludes external chat-channel groups (e.g. wecom/telegram) from collaboration spaces", () => {
    const result = buildWorkbenchCollaborationReadModel({
      spacesResult: {
        spaces: [createManagedSpace({ id: "alpha", groupId: "alpha", title: "产品研发小组" })],
      },
      teamSpaces: [
        {
          id: "wecom:group:daniel",
          key: "agent:bot-2:wecom:group:daniel",
          selectionKey: "agent:bot-2:wecom:group:daniel",
          sessionKeys: ["agent:bot-2:wecom:group:daniel"],
          kind: "space",
          badge: "GR",
          title: "wecom:g-daniel",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 100,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
        {
          id: "tg-group",
          key: "agent:bot:telegram:group:-1001234567890",
          selectionKey: "agent:bot:telegram:group:-1001234567890",
          sessionKeys: ["agent:bot:telegram:group:-1001234567890"],
          kind: "space",
          badge: "GR",
          title: "Sales Channel",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 90,
          unreadCount: 0,
          activity: "active",
          saved: false,
        },
      ],
      sessionsResult: {
        sessions: [
          { key: "space:alpha", updatedAt: 200, kind: "group", groupId: "alpha" },
          {
            key: "agent:bot-2:wecom:group:daniel",
            updatedAt: 100,
            kind: "group",
            chatType: "group",
            channel: "main",
            surface: "wecom",
          },
          {
            key: "agent:bot:telegram:group:-1001234567890",
            updatedAt: 90,
            kind: "group",
            chatType: "group",
            channel: "main",
            surface: "telegram",
          },
        ],
      } as never,
    });

    expect(result.teamSpaces).toHaveLength(1);
    expect(result.teamSpaces?.[0]?.title).toBe("产品研发小组");
  });

  it("excludes external chat-channel groups even when there are no managed spaces", () => {
    const result = buildWorkbenchCollaborationReadModel({
      teamSpaces: [
        {
          id: "wecom:group:daniel",
          key: "agent:bot-2:wecom:group:daniel",
          selectionKey: "agent:bot-2:wecom:group:daniel",
          sessionKeys: ["agent:bot-2:wecom:group:daniel"],
          kind: "space",
          badge: "GR",
          title: "wecom:g-daniel",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 100,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
        {
          id: "alpha",
          key: "space:alpha",
          selectionKey: "space:alpha",
          sessionKeys: ["space:alpha"],
          kind: "space",
          badge: "GR",
          title: "我的小组",
          subtitle: "群组",
          detail: "detail",
          meta: "meta",
          updatedAt: 200,
          unreadCount: 0,
          activity: "active",
          saved: true,
        },
      ],
      sessionsResult: {
        sessions: [
          {
            key: "agent:bot-2:wecom:group:daniel",
            updatedAt: 100,
            kind: "group",
            chatType: "group",
            channel: "main",
            surface: "wecom",
          },
          { key: "space:alpha", updatedAt: 200, kind: "group" },
        ],
      } as never,
    });

    expect(result.teamSpaces?.map((entry) => entry.title)).toEqual(["我的小组"]);
  });
});
