import { expect, it } from "vitest";
import { SYSTEM_INVARIANTS as gatewayInvariants } from "../../gateway/collaboration-dispatch/effective-policy.js";
import { evaluateGovernanceGate as gatewayGovernance } from "../../gateway/collaboration-dispatch/governance-gate.js";
import { boardTodolistDeliveryMapping as gatewayMapping } from "../../gateway/collaboration-dispatch/plan-gate-exec.js";
import { L1_DEFAULT as compilerDefault } from "../../gateway/collaboration-dispatch/policy-compiler.js";
import {
  isEmptySubmissionBody as gatewayEmpty,
  pendingSubmissionMatches as gatewayPending,
} from "../../gateway/collaboration-dispatch/submit-review-versioning.js";
import * as policy from "./index.js";

it("does not export the legacy turn classifier", () => {
  expect(policy).not.toHaveProperty("classifyTurnRelation");
});

it("keeps L1 defaults and hard invariants at their current values", () => {
  expect(policy.L1_DEFAULT).toEqual(compilerDefault);
  expect(policy.SYSTEM_INVARIANTS).toEqual(gatewayInvariants);
  expect(policy.L1_DEFAULT.finalDecisionMode).toBe("human_required");
  expect(policy.L1_DEFAULT.botMaySelfAdvanceWithoutHuman).toBe(false);
  expect(policy.L1_DEFAULT.mentionBotMustRespond).toBe(false);
  expect(policy.SYSTEM_INVARIANTS.l2CannotWidenL1).toBe(true);
  expect(policy.SYSTEM_INVARIANTS.observerCannotWrite).toBe(true);
  expect(policy.peerReviewMustNotDriveAdmission()).toBe(true);
  expect(policy.oralDispatchCreatesBoardFact()).toBe(false);
  expect(policy.freeChatIsTodolist()).toBe(false);
  expect(policy.todolistIsGroupSharedBoardSubrecord()).toBe(false);
  expect(policy.s2DoesNotDefaultSelfAdvanceOn()).toBe(true);
});

it("matches gateway governance, submit, and plan-mapping decisions", () => {
  const effective = {
    governance: {
      botMaySelfAdvanceWithoutHuman: false,
      allowAgentPublishProposal: true,
      decisionMode: "human_required",
    },
  };
  const actor = { type: "bot" as const, id: "bot:a" };
  expect(policy.evaluateGovernanceGate({ action: "finalize_decision", actor, effective })).toEqual(
    gatewayGovernance({ action: "finalize_decision", actor, effective: effective as never }),
  );
  expect(policy.isEmptySubmissionBody("  ")).toBe(gatewayEmpty("  "));
  expect(
    policy.pendingSubmissionMatches({ currentSubmissionId: "a", expectedSubmissionId: "b" }),
  ).toEqual(gatewayPending({ currentSubmissionId: "a", expectedSubmissionId: "b" }));
  for (const status of ["published", "claimed", "applied", "in_progress", "returned", "accepted"]) {
    expect(policy.boardTodolistDeliveryMapping(status)).toEqual(gatewayMapping(status));
  }
});

it("keeps claim edges and private-plan confirmation separate from the session board", () => {
  expect(policy.claimBoardActionAllowed("published", "claim")).toBe(true);
  expect(policy.claimBoardActionAllowed("claimed", "claim")).toBe(false);
  expect(policy.claimBoardActionAllowed("accepted", "cancel")).toBe(false);
  expect(policy.claimBoardActionAllowed("submitted_for_review", "accept")).toBe(true);
  expect(policy.claimBoardActionAllowed("in_progress", "submit")).toBe(true);
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
