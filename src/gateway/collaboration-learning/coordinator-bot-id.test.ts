import type { CollaborationMember, GroupProfile } from "@openbot/collaboration-core";
import { describe, expect, it } from "vitest";
import { BUILTIN_STEWARD_AGENT_ID } from "../../agents/builtin-steward/identity.js";
import { resolveNextCoordinatorBotId, stripBuiltinStewardGroupMembers } from "./shared.js";

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

describe("resolveNextCoordinatorBotId", () => {
  it("keeps an explicit coordinator that is an active member bot", () => {
    expect(
      resolveNextCoordinatorBotId({
        members: [botMember("bot-market"), botMember("bot-writer")],
        requestedBotId: "bot-writer",
      }),
    ).toBe("bot-writer");
  });

  it("does not invent a coordinator when the owner did not choose one", () => {
    expect(
      resolveNextCoordinatorBotId({
        members: [botMember("bot-market"), botMember("bot-writer")],
      }),
    ).toBeNull();
  });

  it("does not fall back to the builtin steward or the first invited bot", () => {
    expect(
      resolveNextCoordinatorBotId({
        profile: { coordinatorBotId: BUILTIN_STEWARD_AGENT_ID } as GroupProfile,
        members: [botMember(BUILTIN_STEWARD_AGENT_ID), botMember("bot-market", "invited")],
        requestedBotId: BUILTIN_STEWARD_AGENT_ID,
      }),
    ).toBeNull();
  });

  it("clears a stored coordinator that is no longer an active member", () => {
    expect(
      resolveNextCoordinatorBotId({
        profile: { coordinatorBotId: "bot-writer" } as GroupProfile,
        members: [botMember("bot-writer", "removed"), botMember("bot-market")],
      }),
    ).toBeNull();
  });
});

describe("stripBuiltinStewardGroupMembers", () => {
  it("removes builtin steward bots and keeps ordinary members", () => {
    expect(
      stripBuiltinStewardGroupMembers([
        botMember(BUILTIN_STEWARD_AGENT_ID),
        botMember("bot-market"),
        {
          memberId: "human:ceo",
          memberKind: "human",
          userId: "user-owner",
          governanceRole: "owner",
          status: "active",
          updatedAtMs: 1,
        },
      ]).map((member) => member.memberId),
    ).toEqual(["bot-market", "human:ceo"]);
  });
});
