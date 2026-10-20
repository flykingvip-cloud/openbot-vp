import type { CollaborationMember } from "@openbot/collaboration-core";
import { describe, expect, it, vi } from "vitest";
import {
  assertSharedBotActivationsAuthorized,
  buildBootstrapSystemInstructions,
  ensureCreatorHumanMember,
  humanMemberMatchesActorIdentities,
  isActorAuthorizedBotOwner,
  isBootstrapManagedSystemInstruction,
  promoteSelfOwnedBotInvites,
  readConfiguredAgentOwnership,
  resolveCollaborationActorIdentities,
  resolveNextGroupOwnerUserId,
  retainCustomSystemInstructions,
} from "./shared.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: {
      list: [
        {
          id: "agt-hrqb-bot",
          scope: "shared",
          ownerType: "position",
          ownerId: "b6ade47f-b9a0-4204-84c5-effe657a5877",
          ownerName: "产品体验-王老师",
        },
      ],
    },
  })),
}));

describe("collaboration space membership helpers", () => {
  it("ensureCreatorHumanMember injects the actor on fresh groups", () => {
    const now = 1_700_000_000_000;
    const nextMembers = ensureCreatorHumanMember({
      existingMembers: [],
      nextMembers: [],
      actor: "hrqb@163.com",
      actorEmployeeUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
      creatorLabel: "王军",
      now,
    });
    expect(nextMembers).toHaveLength(1);
    expect(nextMembers[0]).toMatchObject({
      memberKind: "human",
      userId: "c6862233-2e3e-4c89-a942-ce813e782637",
      name: "王军",
      status: "active",
    });
  });

  it("resolveNextGroupOwnerUserId prefers the creating employee user id", () => {
    const ownerUserId = resolveNextGroupOwnerUserId({
      existingMembers: [],
      nextMembers: [
        {
          memberKind: "human",
          userId: "c6862233-2e3e-4c89-a942-ce813e782637",
          status: "active",
        } as CollaborationMember,
        {
          memberKind: "human",
          userId: "daniel.hhd@gmail.com",
          status: "active",
        } as CollaborationMember,
      ],
      actor: "hrqb@163.com",
      actorEmployeeUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
    });
    expect(ownerUserId).toBe("c6862233-2e3e-4c89-a942-ce813e782637");
  });

  it("isActorAuthorizedBotOwner matches position-owned bots via seat employee user id", () => {
    const botOwnerUserIdByAgentId = new Map([
      ["agt-hrqb-bot", "c6862233-2e3e-4c89-a942-ce813e782637"],
    ]);
    expect(
      isActorAuthorizedBotOwner({
        actor: "hrqb@163.com",
        actorEmployeeUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
        agentId: "agt-hrqb-bot",
        botOwnerUserIdByAgentId,
      }),
    ).toBe(true);
    expect(readConfiguredAgentOwnership("agt-hrqb-bot")).toMatchObject({
      ownerType: "position",
      ownerId: "b6ade47f-b9a0-4204-84c5-effe657a5877",
    });
  });

  it("assertSharedBotActivationsAuthorized allows actor-owned shared bots", () => {
    const botOwnerUserIdByAgentId = new Map([
      ["agt-hrqb-bot", "c6862233-2e3e-4c89-a942-ce813e782637"],
    ]);
    expect(() =>
      assertSharedBotActivationsAuthorized({
        existingMembers: [],
        nextMembers: [
          {
            memberKind: "bot",
            agentId: "agt-hrqb-bot",
            status: "active",
          } as CollaborationMember,
        ],
        actor: "hrqb@163.com",
        actorEmployeeUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
        botOwnerUserIdByAgentId,
      }),
    ).not.toThrow();
  });

  it("promoteSelfOwnedBotInvites upgrades invited owned bots to active", () => {
    const now = 1_700_000_000_000;
    const botOwnerUserIdByAgentId = new Map([
      ["agt-hrqb-bot", "c6862233-2e3e-4c89-a942-ce813e782637"],
    ]);
    const members = promoteSelfOwnedBotInvites({
      members: [
        {
          memberKind: "bot",
          agentId: "agt-hrqb-bot",
          status: "invited",
        } as CollaborationMember,
      ],
      actor: "hrqb@163.com",
      actorEmployeeUserId: "c6862233-2e3e-4c89-a942-ce813e782637",
      botOwnerUserIdByAgentId,
      now,
    });
    expect(members[0]?.status).toBe("active");
  });

  it("humanMemberMatchesActorIdentities matches userId email and handle", () => {
    const identities = resolveCollaborationActorIdentities(
      "hrqb@163.com",
      "c6862233-2e3e-4c89-a942-ce813e782637",
      "hrqb@163.com",
    );
    expect(
      humanMemberMatchesActorIdentities(
        {
          memberId: "h1",
          memberKind: "human",
          userId: "other",
          email: "hrqb@163.com",
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        } as CollaborationMember & { email?: string },
        identities,
      ),
    ).toBe(true);
    expect(
      humanMemberMatchesActorIdentities(
        {
          memberId: "h2",
          memberKind: "human",
          userId: "other",
          handle: "hrqb@163.com",
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        } as CollaborationMember & { handle?: string },
        identities,
      ),
    ).toBe(true);
  });

  it("rebuilds bootstrap owner lines instead of appending stale 群主 text", () => {
    expect(isBootstrapManagedSystemInstruction("群主：王军")).toBe(true);
    expect(isBootstrapManagedSystemInstruction("自定义规则：周五复盘")).toBe(false);

    const stale = ["协作小组名称：旧组名", "群主：王老师", "自定义规则：周五复盘"];
    expect(retainCustomSystemInstructions(stale)).toEqual(["自定义规则：周五复盘"]);

    const members = [
      {
        memberId: "h1",
        memberKind: "human" as const,
        userId: "ceo-user",
        name: "CEO",
        governanceRole: "owner" as const,
        status: "active" as const,
        updatedAtMs: 1,
      },
    ];
    const rebuilt = buildBootstrapSystemInstructions({
      title: "产品测试组",
      profile: { ownerUserId: "ceo-user" } as never,
      members,
      extraInstructions: retainCustomSystemInstructions(stale),
    });
    expect(rebuilt.some((line) => line === "群主：CEO")).toBe(true);
    expect(rebuilt.some((line) => line.includes("王老师"))).toBe(false);
    expect(rebuilt).toContain("自定义规则：周五复盘");
  });
});
