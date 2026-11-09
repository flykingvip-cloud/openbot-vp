import { describe, expect, it } from "vitest";
import { MODE_TEMPLATES, OBSERVER_PERMISSIONS, SYSTEM_INVARIANTS } from "./effective-policy.js";
import { hashEffectiveCollaborationPolicy } from "./policy-compiler-hash.js";
import { compileEffectiveCollaborationPolicy } from "./policy-compiler.js";

describe("compileEffectiveCollaborationPolicy", () => {
  it("applies L1 defaults when the group sends an empty policy", () => {
    const effective = compileEffectiveCollaborationPolicy({});
    expect(effective.protocolVersion).toBe("1.1");
    expect(effective.invariants).toEqual(SYSTEM_INVARIANTS);
    expect(effective.strategy).toEqual(MODE_TEMPLATES.discussion_driven);
    expect(effective.participation.maxVisibleBotRepliesPerRound).toBe(3);
    expect(effective.participation.openDiscussionWithoutMention).toBe(true);
    expect(effective.participation.mentionBotMustRespond).toBe(false);
    expect(effective.dispatch.supplementEnabled).toBe(true);
    expect(effective.participation.mentionMustDispatch).toBe(true);
    expect(effective.participation.mentionMaySilentIfNoIncrement).toBe(true);
    expect(effective.participation.lowSignalStrategy).toBe("one_reply");
    expect(effective.dispatch.primaryThenSupplement).toBe(true);
    expect(effective.dispatch.allowEvidenceCollection).toBe(false);
    expect(effective.dispatch.coordinatorWrap).toBe(false);
    expect(effective.governance.observer).toEqual(OBSERVER_PERMISSIONS);
    expect(effective.clamps).toEqual([]);
  });

  it("clamps L2 visible replies to the L1 ceiling", () => {
    const effective = compileEffectiveCollaborationPolicy({
      maxVisibleBotRepliesPerRound: 20,
    });
    expect(effective.participation.maxVisibleBotRepliesPerRound).toBe(12);
    expect(effective.clamps).toContainEqual({
      field: "maxVisibleBotRepliesPerRound",
      requested: 20,
      effective: 12,
      reason: "l1_resource_ceiling",
      source: "l1-hard",
      constrainedBy: "maxVisibleBotRepliesPerRound <= 12",
    });
    expect(effective.provenance.maxVisibleBotRepliesPerRound).toEqual({
      value: 12,
      source: "l1-hard",
      requested: 20,
      constrainedBy: "maxVisibleBotRepliesPerRound <= 12",
    });
  });

  it("records L2 source when the group stays inside the ceiling", () => {
    const effective = compileEffectiveCollaborationPolicy({
      maxVisibleBotRepliesPerRound: 8,
    });
    expect(effective.provenance.maxVisibleBotRepliesPerRound).toEqual({
      value: 8,
      source: "l2",
      requested: 8,
    });
  });

  it("lets L2 require a visible mention reply without making silence illegal", () => {
    const silent = compileEffectiveCollaborationPolicy({
      mentionBotMustRespond: false,
    });
    expect(silent.participation.mentionBotMustRespond).toBe(false);
    expect(silent.participation.mentionMustDispatch).toBe(true);
    expect(silent.participation.mentionMaySilentIfNoIncrement).toBe(true);
    expect(silent.clamps.some((clamp) => clamp.field === "mentionBotMustRespond")).toBe(false);

    const visible = compileEffectiveCollaborationPolicy({
      mentionBotMustRespond: true,
    });
    expect(visible.participation.mentionBotMustRespond).toBe(true);
    expect(visible.participation.mentionMaySilentIfNoIncrement).toBe(false);
    expect(visible.provenance.mentionBotMustRespond).toEqual({
      value: true,
      source: "l2",
      requested: true,
    });
  });

  it("keeps an explicit open-discussion L2 value alongside the active-discussion default", () => {
    const effective = compileEffectiveCollaborationPolicy({
      openDiscussionWithoutMention: true,
    });
    expect(effective.participation.openDiscussionWithoutMention).toBe(true);
    expect(effective.provenance.openDiscussionWithoutMention.source).toBe("l2");
  });

  it("keeps observer write/approve permanently closed", () => {
    const effective = compileEffectiveCollaborationPolicy({});
    expect(effective.governance.observer.canRespond).toBe(false);
    expect(effective.governance.observer.canExecute).toBe(false);
    expect(effective.governance.observer.canApprove).toBe(false);
    expect(effective.governance.observer.canRead).toBe(true);
  });

  it("compiles mode templates without treating them as a flat enum", () => {
    const review = compileEffectiveCollaborationPolicy({
      collaborationMode: "review_driven",
    });
    expect(review.strategy.primaryStrength).toBe("reviewer_required");
    expect(review.strategy.preserveConflict).toBe(true);
    const unknown = compileEffectiveCollaborationPolicy({
      collaborationMode: "research",
    });
    expect(unknown.strategy.id).toBe("discussion_driven");
    expect(unknown.clamps.some((clamp) => clamp.field === "collaborationMode")).toBe(true);
  });

  it("lets L2 replace the low-signal default without widening L1-Hard", () => {
    const effective = compileEffectiveCollaborationPolicy({
      lowSignalStrategy: "all_named_confirmers",
    });
    expect(effective.participation.lowSignalStrategy).toBe("all_named_confirmers");
    expect(effective.invariants.maxVisibleRepliesCeiling).toBe(12);
  });

  it("treats custom instructions as guidance only", () => {
    const effective = compileEffectiveCollaborationPolicy({
      systemInstructions: ["重要结论先复述约束", "  "],
    });
    expect(effective.guidance.systemInstructions).toEqual(["重要结论先复述约束"]);
  });

  it("hashes the compiled policy without clamp noise", () => {
    const a = compileEffectiveCollaborationPolicy({ maxVisibleBotRepliesPerRound: 5 });
    const b = compileEffectiveCollaborationPolicy({ maxVisibleBotRepliesPerRound: 5 });
    expect(hashEffectiveCollaborationPolicy(a)).toBe(hashEffectiveCollaborationPolicy(b));
    expect(hashEffectiveCollaborationPolicy(a)).toHaveLength(64);
  });

  it("decouples supplement from openDiscussionWithoutMention", () => {
    const closed = compileEffectiveCollaborationPolicy({
      openDiscussionWithoutMention: false,
      allowSupplementAfterPrimary: true,
    });
    expect(closed.participation.openDiscussionWithoutMention).toBe(false);
    expect(closed.dispatch.supplementEnabled).toBe(true);

    const singleOwnerStyle = compileEffectiveCollaborationPolicy({
      openDiscussionWithoutMention: false,
      allowSupplementAfterPrimary: false,
    });
    expect(singleOwnerStyle.dispatch.supplementEnabled).toBe(false);
  });
});

it("preserves an explicit closed-group policy after the active default migration", () => {
  const effective = compileEffectiveCollaborationPolicy({
    openDiscussionWithoutMention: false,
    maxVisibleBotRepliesPerRound: 1,
  });
  expect(effective.participation.openDiscussionWithoutMention).toBe(false);
  expect(effective.participation.maxVisibleBotRepliesPerRound).toBe(1);
  expect(effective.provenance.openDiscussionWithoutMention.source).toBe("l2");
  expect(effective.participation.humanStartsNewRound).toBe(true);
});
