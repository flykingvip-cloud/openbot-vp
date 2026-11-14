import { expect, it } from "vitest";
import { validateRuntimeRuleProposal } from "./validate.js";
import {
  codesOf,
  legalGroupHost,
  legalGroupProposal,
  legalPersonalHost,
  legalPersonalProposal,
} from "./validate.test-support.js";

it("blocks a proposed context window above the current effective cap (64000 vs 32000)", () => {
  const proposal = legalPersonalProposal({
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        action: "tune",
        proposedValue: 64000,
      },
    ],
  });
  const result = validateRuntimeRuleProposal(proposal, legalPersonalHost());
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toEqual(["above_current_effective"]);
  expect(result.activationAllowed).toBe(false);
  expect(result.authorizationAssessment).toBe("host_unauthorized");
});

it("blocks a value below hardMin even when current effective value is missing", () => {
  const host = legalPersonalHost();
  delete host.currentEffectiveValues;
  delete host.compatibilityRecord;
  const proposal = legalPersonalProposal({
    items: [
      {
        ruleId: "model.context_window.guard",
        field: "agents.defaults.contextTokens",
        action: "tune",
        proposedValue: 15999,
      },
    ],
  });
  const result = validateRuntimeRuleProposal(proposal, host);
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("below_hard_min");
  expect(codesOf(result.reasons)).not.toContain("missing_host_fact");
});

it("blocks deletion or nulling submitted as an ordinary tighten", () => {
  const deleted = validateRuntimeRuleProposal(
    legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "delete",
          proposedValue: 24000,
        },
      ],
    }),
    legalPersonalHost(),
  );
  expect(deleted.resultKind).toBe("blocked");
  expect(codesOf(deleted.reasons)).toContain("delete_or_relax_as_tighten");
  const nulled = validateRuntimeRuleProposal(
    legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: null,
        },
      ],
    }),
    legalPersonalHost(),
  );
  expect(nulled.resultKind).toBe("blocked");
  expect(codesOf(nulled.reasons)).toContain("delete_or_relax_as_tighten");
});

it("returns no_change when proposed value equals a legal current baseline", () => {
  const result = validateRuntimeRuleProposal(
    legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 32000,
        },
      ],
    }),
    legalPersonalHost(),
  );
  expect(result.resultKind).toBe("no_change");
  expect(codesOf(result.reasons)).toEqual(["equal_to_legal_baseline"]);
  expect(result.activationAllowed).toBe(false);
});

it("blocks when current effective value is already below hardMin and does not return no_change", () => {
  const host = legalPersonalHost({
    currentEffectiveValues: { "agents.defaults.contextTokens": 8000 },
  });
  const equalButIllegal = validateRuntimeRuleProposal(
    legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 8000,
        },
      ],
    }),
    host,
  );
  expect(equalButIllegal.resultKind).toBe("blocked");
  expect(codesOf(equalButIllegal.reasons)).not.toContain("equal_to_legal_baseline");
  expect(equalButIllegal.resultKind).not.toBe("no_change");

  const legalProposedAgainstLowCurrent = validateRuntimeRuleProposal(legalPersonalProposal(), host);
  expect(legalProposedAgainstLowCurrent.resultKind).toBe("blocked");
  expect(codesOf(legalProposedAgainstLowCurrent.reasons)).toEqual(["current_below_hard_min"]);
});

it("blocks collaboration values above the hard ceiling without clamping through", () => {
  const result = validateRuntimeRuleProposal(
    legalGroupProposal({
      items: [
        {
          ruleId: "collab.policy.compile",
          field: "maxVisibleBotRepliesPerRound",
          action: "tune",
          proposedValue: 99,
        },
      ],
    }),
    legalGroupHost(),
  );
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("above_hard_ceiling");
});

it("blocks a collaboration tighten above the current effective cap of 3", () => {
  const result = validateRuntimeRuleProposal(
    legalGroupProposal({
      items: [
        {
          ruleId: "collab.policy.compile",
          field: "maxVisibleBotRepliesPerRound",
          action: "tune",
          proposedValue: 5,
        },
      ],
    }),
    legalGroupHost(),
  );
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toEqual(["above_current_effective"]);
});

it("asks for lane when a collaboration field is otherwise legal and lane is missing", () => {
  const host = legalGroupHost();
  delete host.lane;
  const result = validateRuntimeRuleProposal(legalGroupProposal(), host);
  expect(result.resultKind).toBe("needs_information");
  expect(result.reasons.some((entry) => entry.missingFact === "lane")).toBe(true);
  expect(result.activationAllowed).toBe(false);
});

it("asks for currentEffectiveValue when it is omitted and no independent reject applies", () => {
  const host = legalPersonalHost();
  delete host.currentEffectiveValues;
  const result = validateRuntimeRuleProposal(legalPersonalProposal(), host);
  expect(result.resultKind).toBe("needs_information");
  expect(result.reasons.some((entry) => entry.missingFact === "currentEffectiveValue")).toBe(true);
});

it("blocks a whole batch that mixes a legal tighten with a non-candidate field", () => {
  const proposal = legalGroupProposal({
    items: [
      {
        ruleId: "collab.policy.compile",
        field: "maxVisibleBotRepliesPerRound",
        action: "tune",
        proposedValue: 2,
      },
      {
        ruleId: "collab.policy.compile",
        field: "botMaySelfAdvanceWithoutHuman",
        action: "tune",
        proposedValue: 1,
      },
    ],
  });
  const result = validateRuntimeRuleProposal(proposal, legalGroupHost());
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("non_candidate_field");
  expect(result.items).toHaveLength(2);
  expect(result.items.every((item) => item.resultKind === "blocked")).toBe(true);
});

it("blocks identity or scope mismatch using already-provided host identity", () => {
  const result = validateRuntimeRuleProposal(
    legalPersonalProposal(),
    legalPersonalHost({
      identity: {
        principalType: "enterprise",
        principalId: "org:fixture-1",
        scope: { type: "enterprise", id: "org:fixture-1" },
      },
    }),
  );
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("identity_scope_mismatch");
});

it("blocks unauthorized actions such as select or disable on a shadow candidate", () => {
  const result = validateRuntimeRuleProposal(
    legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "disable",
          proposedValue: 24000,
        },
      ],
    }),
    legalPersonalHost(),
  );
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("unauthorized_action");
});

it("blocks a host compatibility record that is unapproved", () => {
  const host = legalPersonalHost();
  const record = host.compatibilityRecord as Record<string, unknown>;
  record.status = "unapproved";
  const result = validateRuntimeRuleProposal(legalPersonalProposal(), host);
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toEqual(["compatibility_not_approved"]);
});

it("front-loads independently decidable rejects when several problems exist", () => {
  const host = legalPersonalHost({ expectedPolicyState: "tombstone" });
  delete host.compatibilityRecord;
  delete host.currentEffectiveValues;
  const proposal = legalPersonalProposal({
    items: [
      {
        ruleId: "collab.policy.unknown",
        field: "agents.defaults.contextTokens",
        action: "tune",
        proposedValue: 24000,
      },
    ],
  });
  const result = validateRuntimeRuleProposal(proposal, host);
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("unknown_rule_id");
  expect(codesOf(result.reasons)).toContain("cancelled_or_tombstone");
  expect(codesOf(result.reasons)).not.toContain("missing_host_fact");
});

it("structurally rejects forged authorization even when the host authorization status is omitted", () => {
  const host = legalPersonalHost();
  delete host.authorizationStatus;
  const proposal = legalPersonalProposal({ authorizationStatus: "authorized" });
  const result = validateRuntimeRuleProposal(proposal, host);
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("structural_forbidden_field");
  expect(codesOf(result.reasons)).not.toContain("missing_host_fact");
  expect(result.authorizationAssessment).toBe("assessment_unavailable");
});

it("structurally rejects unknown proposal fields and does not ignore them", () => {
  const result = validateRuntimeRuleProposal(
    legalPersonalProposal({ extraComment: "please ignore" }),
    legalPersonalHost(),
  );
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("structural_unknown_field");
});

it("blocks duplicate fields even when the repeated values are identical", () => {
  const result = validateRuntimeRuleProposal(
    legalPersonalProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 24000,
        },
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 24000,
        },
      ],
    }),
    legalPersonalHost(),
  );
  expect(result.resultKind).toBe("blocked");
  expect(codesOf(result.reasons)).toContain("structural_duplicate_field");
  expect(result.items).toHaveLength(2);
});
