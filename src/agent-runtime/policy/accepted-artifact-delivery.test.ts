import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveAcceptedArtifactIssuanceBasis,
  establishTrustedDeliveryIssuer,
  evaluateAcceptedArtifactOutboundAuthorization,
  evaluateChannelAccountOutboundScope,
  evaluateMemberArtifactDeliveryEligibility,
  issueOutboundArtifactGrant,
  memberArtifactDeliveryKeyMaterial,
  normalizeDeliveryTarget,
  type AcceptedArtifactIssuanceFacts,
  type ChannelAccountOutboundScopeFacts,
  type MemberArtifactDeliveryIdentity,
} from "./index.js";

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

describe("evaluateAcceptedArtifactOutboundAuthorization", () => {
  const target = { channel: "telegram", accountId: null, to: "chat-1" };
  const request = {
    tenantId: "ten-a",
    groupId: "grp-1",
    actorId: "bot-b",
    normalizedTarget: target,
    acceptedArtifactVersion: "art-v1",
    linkedContentSha256: "abc",
  };
  const grant = {
    tenantId: "ten-a",
    groupId: "grp-1",
    actorId: "bot-b",
    channel: "telegram",
    accountId: null,
    to: "chat-1",
    scope: "member_artifact" as const,
    acceptedArtifactVersion: "art-v1",
    linkedContentSha256: "abc",
    revokedAtMs: null,
  };

  it("stays pending when the server grant is missing", () => {
    const decision = evaluateAcceptedArtifactOutboundAuthorization({ ...request, grant: null });
    expect(decision).toEqual({
      outcome: "authorization_pending",
      reason: "outbound_auth_grant_missing",
    });
    expect("granted" in decision).toBe(false);
  });

  it("denies a revoked grant or a different artifact", () => {
    expect(
      evaluateAcceptedArtifactOutboundAuthorization({
        ...request,
        grant: { ...grant, revokedAtMs: 10 },
      }),
    ).toEqual({ outcome: "deny", reason: "outbound_authorization_revoked" });
    expect(
      evaluateAcceptedArtifactOutboundAuthorization({
        ...request,
        grant: { ...grant, linkedContentSha256: "other" },
      }),
    ).toEqual({ outcome: "deny", reason: "outbound_grant_mismatch" });
    expect(evaluateAcceptedArtifactOutboundAuthorization({ ...request, grant }).outcome).toBe(
      "allow",
    );
  });
});

describe("issueOutboundArtifactGrant", () => {
  const text = "member-body";
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const facts: AcceptedArtifactIssuanceFacts = {
    groupId: "grp-1",
    taskId: "task-1",
    itemId: "item-1",
    scope: "member_artifact",
    boardStatus: "accepted",
    acceptedSubmissionId: "sub-1",
    acceptedArtifactVersion: "art-v1",
    linkedDeliverableId: "del-1",
    linkedDeliverableVersion: 1,
    linkedContentSha256: hash,
    deliverableId: "del-1",
    deliverableVersion: 1,
    deliverableContentSha256: hash,
    plainText: text,
  };
  const issuerInput = {
    source: "resolveTrustedWriteContext",
    tenantId: "ten-a",
    actorId: "bot-b",
    groupId: "grp-1",
    groupAction: "write",
  };

  it("issues only from a trusted write context and the stored artifact", () => {
    const issuer = establishTrustedDeliveryIssuer(issuerInput);
    const basis = deriveAcceptedArtifactIssuanceBasis(facts);
    const grant = issueOutboundArtifactGrant({
      issuer,
      basis,
      target: { channel: "telegram", to: "chat-1" },
    });
    expect(grant?.actorId).toBe("bot-b");
    expect(grant?.linkedContentSha256).toBe(hash);
    expect(establishTrustedDeliveryIssuer({ ...issuerInput, groupAction: "read" })).toBeNull();
    expect(establishTrustedDeliveryIssuer(null)).toBeNull();
    expect(deriveAcceptedArtifactIssuanceBasis({ ...facts, scope: "group_final" })?.scope).toBe(
      "group_final",
    );
    expect(
      deriveAcceptedArtifactIssuanceBasis({ ...facts, mediaUrl: "https://example.invalid/a.png" }),
    ).toBeNull();
    expect(
      issueOutboundArtifactGrant({
        issuer: null,
        basis,
        target: { channel: "telegram", to: "chat-1" },
      }),
    ).toBeNull();
  });
});

describe("evaluateChannelAccountOutboundScope", () => {
  const target = { channel: "telegram", accountId: null, to: "chat-1" };
  const facts: ChannelAccountOutboundScopeFacts = {
    channel: "telegram",
    accountId: null,
    accountEnabled: true,
    allowedDestinations: ["chat-1"],
  };

  it("allows only when the target matches server defaultTo scope", () => {
    expect(evaluateChannelAccountOutboundScope({ target, facts })).toEqual({
      outcome: "allow",
      reason: "channel_account_outbound_scope",
    });
  });

  it("stays pending when scope facts or destinations are missing", () => {
    expect(evaluateChannelAccountOutboundScope({ target, facts: null })).toEqual({
      outcome: "authorization_pending",
      reason: "outbound_scope_basis_missing",
    });
    expect(
      evaluateChannelAccountOutboundScope({
        target,
        facts: { ...facts, allowedDestinations: ["  ", ""] },
      }),
    ).toEqual({
      outcome: "authorization_pending",
      reason: "outbound_scope_basis_missing",
    });
  });

  it("denies write-ok facts when the target is outside defaultTo", () => {
    expect(
      evaluateChannelAccountOutboundScope({
        target: { ...target, to: "other-chat" },
        facts,
      }),
    ).toEqual({ outcome: "deny", reason: "outbound_target_out_of_scope" });
  });

  it("denies a disabled channel account", () => {
    expect(
      evaluateChannelAccountOutboundScope({
        target,
        facts: { ...facts, accountEnabled: false },
      }),
    ).toEqual({ outcome: "deny", reason: "channel_account_disabled" });
  });
});
