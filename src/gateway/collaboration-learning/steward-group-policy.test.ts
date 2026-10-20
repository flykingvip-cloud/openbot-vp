import type { CollaborationMember } from "@openbot/collaboration-core";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_STEWARD_AGENT_ID } from "../../agents/builtin-steward/identity.js";
import {
  assertBuiltinStewardGroupMembershipAllowed,
  resolveCollaborationGroupOwnerEntitlementScope,
} from "./steward-group-policy.js";

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({ gateway: { auth: { trustedProxy: { enabled: false } } } }),
}));

vi.mock("../ownership-store.js", () => ({
  listOwnershipRecords: () => [
    {
      tenantId: "001",
      subjectKind: "group",
      subjectId: "grp_ai",
      positionId: "seat-owner",
      bindingStatus: "active",
      currentManagerUserId: "user-owner",
    },
  ],
}));

vi.mock("../enterprise-seat-assets-store.js", () => ({
  loadEnterpriseSeatAssetsStore: async () => ({ assetBindings: {}, seats: {} }),
}));

vi.mock("../platform-auth.js", () => ({
  resolvePlatformAuthConfig: () => null,
  loadPlatformAuthStore: async () => ({ users: {} }),
}));

function botMember(
  agentId: string,
  status: CollaborationMember["status"] = "active",
): CollaborationMember {
  return {
    memberId: agentId,
    memberKind: "bot",
    agentId,
    governanceRole: "member",
    status,
    updatedAtMs: 1,
  };
}

describe("assertBuiltinStewardGroupMembershipAllowed", () => {
  it("rejects adding builtin steward even when the owner asks", () => {
    expect(() =>
      assertBuiltinStewardGroupMembershipAllowed({
        existingMembers: [],
        nextMembers: [botMember(BUILTIN_STEWARD_AGENT_ID)],
        ownerUserId: "user-owner",
        actor: "user-owner",
      }),
    ).toThrow(/大白管家不是协作小组成员/);
  });

  it("does not block a repair write that still lists an existing steward", () => {
    expect(() =>
      assertBuiltinStewardGroupMembershipAllowed({
        existingMembers: [botMember(BUILTIN_STEWARD_AGENT_ID, "active")],
        nextMembers: [botMember(BUILTIN_STEWARD_AGENT_ID, "active")],
        ownerUserId: "user-owner",
        actor: "user-owner",
      }),
    ).not.toThrow();
  });

  it("allows a roster that only contains ordinary bots", () => {
    expect(() =>
      assertBuiltinStewardGroupMembershipAllowed({
        existingMembers: [],
        nextMembers: [botMember("bot-market")],
        ownerUserId: "user-owner",
        actor: "user-owner",
      }),
    ).not.toThrow();
  });
});

describe("resolveCollaborationGroupOwnerEntitlementScope", () => {
  it("resolves tenant and owner seat from group ownership record", async () => {
    const scope = await resolveCollaborationGroupOwnerEntitlementScope({
      groupId: "grp_ai",
      operatingState: {
        governance: { ownerUserId: "user-owner", adminUserIds: [] },
      } as never,
      members: { humans: [], bots: [] },
    });

    expect(scope).toEqual({
      tenantId: "001",
      seatId: "seat-owner",
      employeeId: "user-owner",
    });
  });
});
