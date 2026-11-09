import { expect, it } from "vitest";
import * as policy from "./index.js";

/** Captured from the gateway compiler before this move. Not compared to a re-export. */
const EMPTY_POLICY_HASH = "af8fc3ccd96c2038fbdfb6af8799bca488daa93433d9eb1d667d752c3e97f52a";
const EMPTY_LEGACY_HASH = "c3b82cd4f227d042254c971dabf40f14ae19ac2bca36b3f0479f1ee4d45600ca";
const WIDENED_VISIBLE_HASH = "81431e093940792af5109035961214d4007c88d9071504aa8e83e85f3059c60f";

it("does not export the legacy turn classifier", () => {
  expect(policy).not.toHaveProperty("classifyTurnRelation");
});

it("keeps L1 defaults and hard invariants at their current values", () => {
  expect(policy.L1_DEFAULT.finalDecisionMode).toBe("human_required");
  expect(policy.L1_DEFAULT.botMaySelfAdvanceWithoutHuman).toBe(false);
  expect(policy.L1_DEFAULT.mentionBotMustRespond).toBe(false);
  expect(policy.L1_DEFAULT.maxVisibleBotRepliesPerRound).toBe(5);
  expect(policy.SYSTEM_INVARIANTS.l2CannotWidenL1).toBe(true);
  expect(policy.SYSTEM_INVARIANTS.observerCannotWrite).toBe(true);
  expect(policy.SYSTEM_INVARIANTS.maxVisibleRepliesCeiling).toBe(12);
  expect(policy.peerReviewMustNotDriveAdmission()).toBe(true);
  expect(policy.oralDispatchCreatesBoardFact()).toBe(false);
  expect(policy.freeChatIsTodolist()).toBe(false);
  expect(policy.todolistIsGroupSharedBoardSubrecord()).toBe(false);
  expect(policy.s2DoesNotDefaultSelfAdvanceOn()).toBe(true);
});

it("pins compiler limits and hashes captured before the policy move", () => {
  const empty = policy.compileEffectiveCollaborationPolicy({});
  expect(empty.participation.maxVisibleBotRepliesPerRound).toBe(5);
  expect(empty.participation.openDiscussionWithoutMention).toBe(false);
  expect(empty.governance.decisionMode).toBe("human_required");
  expect(empty.governance.botMaySelfAdvanceWithoutHuman).toBe(false);
  expect(empty.invariants.maxVisibleRepliesCeiling).toBe(12);
  expect(policy.hashEffectiveCollaborationPolicy(empty)).toBe(EMPTY_POLICY_HASH);
  expect(policy.hashLegacyEffectivePolicySlice(empty)).toBe(EMPTY_LEGACY_HASH);
  const widened = policy.compileEffectiveCollaborationPolicy({ maxVisibleBotRepliesPerRound: 99 });
  expect(widened.participation.maxVisibleBotRepliesPerRound).toBe(12);
  expect(policy.hashEffectiveCollaborationPolicy(widened)).toBe(WIDENED_VISIBLE_HASH);
  expect(
    policy.compileEffectiveCollaborationPolicy({ collaborationMode: "nope" }).strategy.id,
  ).toBe("discussion_driven");
  expect(policy.clampMaxBeatsPerEpisode(undefined)).toBe(1);
  expect(policy.clampMaxBeatsPerEpisode(99)).toBe(12);
});

it("pins illegal claim edges and handoff approval", () => {
  const refused: Array<[string, policy.ClaimBoardAction]> = [
    ["accepted", "cancel"],
    ["published", "accept"],
    ["claimed", "submit"],
    ["blocked", "claim"],
    ["cancelled", "mark_in_progress"],
  ];
  for (const [status, action] of refused) {
    expect(policy.claimBoardActionAllowed(status, action)).toBe(false);
  }
  expect(policy.claimBoardActionAllowed("published", "claim")).toBe(true);
  expect(policy.claimBoardActionAllowed("in_progress", "submit")).toBe(true);
  expect(policy.claimBoardActionAllowed("submitted_for_review", "accept")).toBe(true);
  expect(policy.resolveHandoffApproval("owner_transfer", "owner", "none")).toBe("human");
  expect(policy.resolveHandoffApproval("continue", "executor", undefined)).toBe("none");
  expect(
    policy.classifyHandoffApplyAgainstLive({
      contract: {
        handoffId: "h1",
        kind: "owner_transfer",
        from: { agentId: "a", responsibilityRole: "owner" },
        to: { agentId: "b", responsibilityRole: "owner" },
        baseHistoryLen: 1,
      },
      live: { ownerMemberId: "a", handoffs: [] },
      liveHistoryLen: 2,
    }).kind,
  ).toBe("conflict");
});

it("matches fixed governance, submit, and plan-mapping outcomes", () => {
  const effective = {
    governance: {
      botMaySelfAdvanceWithoutHuman: false,
      allowAgentPublishProposal: true,
      decisionMode: "human_required",
    },
  };
  const actor = { type: "bot" as const, id: "bot:a" };
  expect(policy.evaluateGovernanceGate({ action: "finalize_decision", actor, effective })).toEqual({
    allowed: false,
    reason: "human_override_required",
    message: "final decision requires a human confirmation",
  });
  expect(policy.isEmptySubmissionBody("  ")).toBe(true);
  expect(
    policy.pendingSubmissionMatches({ currentSubmissionId: "a", expectedSubmissionId: "b" }),
  ).toEqual({
    ok: false,
    reason: "submission_version_mismatch",
    message: "expectedSubmissionId b does not match pending a; refuse stale/wrong version",
  });
  expect(policy.boardTodolistDeliveryMapping("published").deliverySelfAdvanceEligible).toBe(false);
  expect(policy.boardTodolistDeliveryMapping("applied").deliverySelfAdvanceEligible).toBe(true);
  expect(policy.boardTodolistDeliveryMapping("accepted").draftAllowed).toBe(false);
});

it("keeps claim edges and private-plan confirmation separate from the session board", () => {
  expect(policy.claimBoardActionAllowed("blocked", "mark_in_progress")).toBe(true);
  expect(policy.isTodolistConfirmedForDelivery({ status: "confirmed" })).toBe(true);
  expect(policy.isTodolistConfirmedForDelivery({ status: "proposed" })).toBe(false);
  expect(
    policy.peerReviewAcceptAllowed({ requirePeerReview: false, nonAuthorReviewCount: 0 }),
  ).toEqual({ ok: true });
  expect(
    policy.peerReviewAcceptAllowed({ requirePeerReview: true, nonAuthorReviewCount: 0 }).ok,
  ).toBe(false);
});
