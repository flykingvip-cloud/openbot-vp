import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  evaluateGroupFinalDeliveryEligibility,
  evaluateGroupFinalOverallAcceptance,
  evaluateMemberArtifactDeliveryEligibility,
  issueOutboundArtifactGrant,
  establishTrustedDeliveryIssuer,
  deriveAcceptedArtifactIssuanceBasis,
  type MemberArtifactDeliveryIdentity,
  type AcceptedArtifactIssuanceFacts,
} from "./accepted-artifact-delivery.js";

function identity(
  patch: Partial<MemberArtifactDeliveryIdentity> = {},
): MemberArtifactDeliveryIdentity {
  return {
    tenantId: "ten-a",
    groupId: "grp-1",
    taskId: "task-1",
    itemId: "item-1",
    actorId: "bot-coord",
    scope: "group_final",
    boardStatus: "accepted",
    acceptedSubmissionId: "sub-1",
    acceptedArtifactVersion: "art-v1",
    linkedDeliverableId: "del-1",
    linkedDeliverableVersion: 1,
    linkedContentSha256: "abc",
    target: { channel: "telegram", accountId: "acct", to: "chat-1" },
    ...patch,
  };
}

describe("evaluateGroupFinalOverallAcceptance", () => {
  it("allows a pinned accepted version with criteria and refuses bare chat completion", () => {
    expect(
      evaluateGroupFinalOverallAcceptance({
        boardStatus: "accepted",
        acceptanceReason: "条款齐备，版本 art-v1 通过",
        boardAcceptanceCriteria: ["A", "B"],
        checkedAcceptanceCriteria: ["A", "B"],
        acceptedArtifactVersion: "art-v1",
        pinnedArtifactVersion: "art-v1",
      }),
    ).toEqual({ outcome: "allow", reason: "group_final_overall_accepted" });

    expect(
      evaluateGroupFinalOverallAcceptance({
        boardStatus: "accepted",
        acceptanceReason: "完成",
        acceptedArtifactVersion: "art-v1",
        pinnedArtifactVersion: "art-v1",
      }),
    ).toEqual({ outcome: "deny", reason: "chat_completion_is_not_acceptance" });

    expect(
      evaluateGroupFinalOverallAcceptance({
        boardStatus: "accepted",
        acceptanceReason: "ok",
        acceptedArtifactVersion: "art-v1",
        pinnedArtifactVersion: "art-v2",
      }),
    ).toEqual({ outcome: "deny", reason: "group_final_version_mismatch" });
  });
});

describe("evaluateGroupFinalDeliveryEligibility", () => {
  it("pending for complete group_final and does not upgrade member scope", () => {
    expect(evaluateGroupFinalDeliveryEligibility(identity())).toEqual({
      outcome: "authorization_pending",
      reason: "outbound_auth_unwired",
    });
    expect(evaluateGroupFinalDeliveryEligibility(identity({ scope: "member_artifact" }))).toEqual({
      outcome: "deny",
      reason: "member_artifact_not_group_final",
    });
    expect(evaluateMemberArtifactDeliveryEligibility(identity())).toEqual({
      outcome: "deny",
      reason: "group_final_not_member_artifact",
    });
  });
});

describe("group_final grant scope", () => {
  it("issues a group_final grant from group_final basis", () => {
    const plainText = "final body";
    const hash = createHash("sha256").update(plainText, "utf8").digest("hex");
    const facts: AcceptedArtifactIssuanceFacts = {
      groupId: "grp-1",
      taskId: "task-1",
      itemId: "item-1",
      scope: "group_final",
      boardStatus: "accepted",
      acceptedSubmissionId: "sub-1",
      acceptedArtifactVersion: "art-v1",
      linkedDeliverableId: "del-1",
      linkedDeliverableVersion: 1,
      linkedContentSha256: hash,
      deliverableId: "del-1",
      deliverableVersion: 1,
      deliverableContentSha256: hash,
      plainText,
    };
    const basis = deriveAcceptedArtifactIssuanceBasis(facts);
    expect(basis?.scope).toBe("group_final");
    const issuer = establishTrustedDeliveryIssuer({
      source: "resolveTrustedWriteContext",
      tenantId: "ten-a",
      actorId: "bot-coord",
      groupId: "grp-1",
      groupAction: "write",
    });
    const grant = issueOutboundArtifactGrant({
      issuer,
      basis,
      target: { channel: "telegram", accountId: "acct", to: "chat-1" },
    });
    expect(grant?.scope).toBe("group_final");
  });
});
