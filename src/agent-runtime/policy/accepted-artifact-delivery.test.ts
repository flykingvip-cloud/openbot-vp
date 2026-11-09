import { describe, expect, it } from "vitest";
import {
  evaluateMemberArtifactDeliveryEligibility,
  memberArtifactDeliveryKeyMaterial,
  normalizeDeliveryTarget,
  type MemberArtifactDeliveryIdentity,
} from "./accepted-artifact-delivery.js";

function identity(
  patch: Partial<MemberArtifactDeliveryIdentity> = {},
): MemberArtifactDeliveryIdentity {
  return {
    tenantId: "ten-a",
    groupId: "grp-1",
    taskId: "task-1",
    itemId: "item-1",
    actorId: "bot-b",
    scope: "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: "sub-1",
    acceptedArtifactVersion: "art-v1",
    linkedDeliverableId: "del-1",
    linkedDeliverableVersion: 1,
    linkedContentSha256: "abc",
    target: { channel: "Telegram", accountId: " acct ", to: " chat-1 " },
    ...patch,
  };
}

describe("evaluateMemberArtifactDeliveryEligibility", () => {
  it("does not treat a complete member artifact as outbound permission", () => {
    const result = evaluateMemberArtifactDeliveryEligibility(identity());
    expect(result).toEqual({
      outcome: "authorization_pending",
      reason: "outbound_auth_unwired",
    });
  });

  it("denies group-final scope", () => {
    expect(evaluateMemberArtifactDeliveryEligibility(identity({ scope: "group_final" }))).toEqual({
      outcome: "deny",
      reason: "group_final_not_member_artifact",
    });
  });

  it("denies a missing target and an unaccepted item", () => {
    expect(
      evaluateMemberArtifactDeliveryEligibility(identity({ target: { channel: "", to: "" } })),
    ).toEqual({ outcome: "deny", reason: "target_required" });
    expect(
      evaluateMemberArtifactDeliveryEligibility(identity({ boardStatus: "submitted_for_review" })),
    ).toEqual({ outcome: "deny", reason: "not_accepted" });
  });

  it("puts tenant and the normalized target into the key material", () => {
    const target = normalizeDeliveryTarget(identity().target);
    expect(target).toEqual({ channel: "telegram", accountId: "acct", to: "chat-1" });
    const left = memberArtifactDeliveryKeyMaterial(identity(), target!);
    const right = memberArtifactDeliveryKeyMaterial(identity({ tenantId: "ten-b" }), target!);
    expect(left).not.toBe(right);
    const splitLeft = memberArtifactDeliveryKeyMaterial(
      identity({ tenantId: "a\nb", groupId: "c" }),
      target!,
    );
    const splitRight = memberArtifactDeliveryKeyMaterial(
      identity({ tenantId: "a", groupId: "b\nc" }),
      target!,
    );
    expect(splitLeft).not.toBe(splitRight);
  });
});
