import { expect, it } from "vitest";
import { codesOf, pathsOf } from "../../policy/rule-adaptation/validate.test-support.js";
import { runShadowRuleAdaptation } from "./run.js";
import {
  candidateOutput,
  fixtureHost,
  fixtureRequest,
  limitedPersonalView,
  maliciousRuleView,
  messageStep,
  noChangeOutput,
  proposalOutput,
  scriptedModel,
  toolStep,
  tightenProposal,
} from "./test-support.js";

function shadowCodes(result: Awaited<ReturnType<typeof runShadowRuleAdaptation>>): string[] {
  return result.reasons.map((entry) => entry.code);
}

function shadowPaths(
  result: Awaited<ReturnType<typeof runShadowRuleAdaptation>>,
): Array<string | undefined> {
  return result.reasons.map((entry) => entry.path);
}

it("records no_change_needed when no rule change is required", async () => {
  const { host, board } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([messageStep(noChangeOutput())]),
  });
  expect(result.outcomeCode).toBe("no_change_needed");
  expect(shadowCodes(result)).toContain("no_change_needed");
  expect(shadowPaths(result)).toContain("model.output");
  expect(result.activationAllowed).toBe(false);
  expect(result.claimedEffective).toBe(false);
  expect(result.commitment).toBe("none");
  expect(board.mutations()).toEqual([]);
});

it("returns insufficient_sources when host facts and the limited view are missing", async () => {
  const { host } = fixtureHost(
    limitedPersonalView({
      rules: [],
      effectivePolicy: [],
      hostFacts: {
        fixture: true,
        identity: {
          principalType: "personal",
          principalId: "user:fixture-1",
          scope: { type: "personal", id: "agent:fixture-personal-1" },
        },
      },
    }),
  );
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("searchRules", { query: "context" }),
      messageStep(
        JSON.stringify({
          protocolVersion: "runtime-rule-adaptation-shadow/v1",
          intent: "insufficient_sources",
        }),
      ),
    ]),
  });
  expect(result.outcomeCode).toBe("insufficient_sources");
  expect(shadowCodes(result)).toContain("insufficient_sources");
  expect(result.activationAllowed).toBe(false);
});

it("maps missing current effective values from the validator to insufficient_sources", async () => {
  const { host } = fixtureHost(
    limitedPersonalView({
      effectivePolicy: [],
      hostFacts: {
        fixture: true,
        identity: {
          principalType: "personal",
          principalId: "user:fixture-1",
          scope: { type: "personal", id: "agent:fixture-personal-1" },
        },
        authorizationStatus: "unauthorized",
      },
    }),
  );
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([messageStep(proposalOutput(tightenProposal()))]),
  });
  expect(result.outcomeCode).toBe("insufficient_sources");
  expect(shadowCodes(result)).toContain("missing_host_fact");
  expect(result.validation?.resultKind).toBe("needs_information");
  expect(result.activationAllowed).toBe(false);
});

it("returns tool_unavailable when a required read tool is disabled", async () => {
  const { host } = fixtureHost(
    limitedPersonalView({
      tools: { searchRules: false, getRuleDefinition: false, getEffectivePolicy: false },
    }),
  );
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("searchRules", { query: "context" }),
      messageStep(
        JSON.stringify({
          protocolVersion: "runtime-rule-adaptation-shadow/v1",
          intent: "tool_unavailable",
        }),
      ),
    ]),
  });
  expect(result.outcomeCode).toBe("tool_unavailable");
  expect(
    result.toolsInvoked.some(
      (entry) => entry.code === "tool_unavailable" && entry.path === "tools.searchRules",
    ),
  ).toBe(true);
  expect(shadowCodes(result)).toContain("tool_unavailable");
  expect(shadowPaths(result)).toContain("model.output");
});

it("returns insufficient_permission when the host denies effective-policy reads", async () => {
  const { host } = fixtureHost(
    limitedPersonalView({ permissions: { readEffectivePolicy: false } }),
  );
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("getEffectivePolicy", { field: "agents.defaults.contextTokens" }),
      messageStep(
        JSON.stringify({
          protocolVersion: "runtime-rule-adaptation-shadow/v1",
          intent: "insufficient_permission",
        }),
      ),
    ]),
  });
  expect(result.outcomeCode).toBe("insufficient_permission");
  expect(
    result.toolsInvoked.some(
      (entry) =>
        entry.code === "insufficient_permission" && entry.path === "tools.getEffectivePolicy",
    ),
  ).toBe(true);
  expect(shadowCodes(result)).toContain("insufficient_permission");
});

it("records hard_rule_conflict with stable validator codes and paths", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([messageStep(proposalOutput(tightenProposal(64000)))]),
  });
  expect(result.outcomeCode).toBe("hard_rule_conflict");
  expect(result.validation?.activationAllowed).toBe(false);
  expect(result.validation?.resultKind).toBe("blocked");
  expect(codesOf(result.validation?.reasons ?? [])).toEqual(["above_current_effective"]);
  expect(pathsOf(result.validation?.reasons ?? [])).toEqual(["proposal.items[0].proposedValue"]);
  expect(shadowCodes(result)).toContain("above_current_effective");
  expect(shadowPaths(result)).toContain("proposal.items[0].proposedValue");
  expect(result.shadowDiff[0]?.comparison).toBe("widen_or_other");
});

it("rejects malicious materials and forged activation fields", async () => {
  const { host } = fixtureHost(maliciousRuleView());
  const forged = tightenProposal();
  forged.activationAllowed = true;
  forged.activateNow = true;
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("getRuleDefinition", { id: "model.context_window.guard" }),
      messageStep(proposalOutput(forged)),
    ]),
  });
  expect(result.outcomeCode).toBe("malicious_material_rejected");
  expect(result.activationAllowed).toBe(false);
  expect(result.claimedEffective).toBe(false);
  expect(result.readOnlyProof.policyActivated).toBe(false);
  expect(shadowCodes(result)).toContain("structural_forbidden_field");
  expect(result.toolsInvoked.some((entry) => entry.name === "getRuleDefinition")).toBe(true);
});

it("does not let tainted materials override the protocol when the model stays clean", async () => {
  const { host, board } = fixtureHost(maliciousRuleView());
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("getRuleDefinition", { id: "model.context_window.guard" }),
      messageStep(proposalOutput(tightenProposal(24000))),
    ]),
  });
  expect(result.outcomeCode).toBe("shadow_recorded");
  expect(result.validation?.resultKind).toBe("shadow_accepted");
  expect(result.validation?.activationAllowed).toBe(false);
  expect(result.claimedEffective).toBe(false);
  expect(board.mutations()).toEqual([]);
});

it("flags fabricated rule ids", async () => {
  const { host } = fixtureHost();
  const proposal = tightenProposal();
  proposal.items = [
    {
      ruleId: "invented.shadow.rule",
      field: "agents.defaults.contextTokens",
      action: "tune",
      proposedValue: 24000,
    },
  ];
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([messageStep(proposalOutput(proposal))]),
  });
  expect(result.outcomeCode).toBe("fabricated_rule_id");
  expect(shadowCodes(result)).toContain("unknown_rule_id");
  expect(result.activationAllowed).toBe(false);
});

it("flags unknown parameters that are not approved shadow fields", async () => {
  const { host } = fixtureHost();
  const proposal = tightenProposal();
  proposal.items = [
    {
      ruleId: "model.context_window.guard",
      field: "totallyUnknownParam",
      action: "tune",
      proposedValue: 24000,
    },
  ];
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([messageStep(proposalOutput(proposal))]),
  });
  expect(result.outcomeCode).toBe("unknown_parameter");
  expect(shadowCodes(result)).toContain("non_candidate_field");
  expect(result.activationAllowed).toBe(false);
});

it("validates a rule candidate without recording, activating, or persisting it", async () => {
  const { host, board } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      toolStep("submitRuleCandidate", { enablePersist: true, proposal: "candidate" }),
      messageStep(candidateOutput()),
    ]),
  });
  expect(result.outcomeCode).toBe("candidate_validated_not_recorded");
  expect(result.validation?.resultKind).toBe("candidate_validated");
  expect(result.validation?.activationAllowed).toBe(false);
  expect(result.candidateToolInvoked).toBe(true);
  expect(result.candidatePersisted).toBe(false);
  expect(result.candidateActivated).toBe(false);
  expect(result.candidatePublished).toBe(false);
  expect(result.readOnlyProof.configWritten).toBe(false);
  expect(result.readOnlyProof.rulesPublished).toBe(false);
  expect(
    result.toolsInvoked.some(
      (entry) =>
        entry.name === "submitRuleCandidate" &&
        entry.code === "p2_persist_forbidden" &&
        entry.path === "candidateEntry.submitRuleCandidate",
    ),
  ).toBe(true);
  expect(board.mutations()).toEqual([]);
});

it("records a legal shadow tighten and compares it to the current effective policy", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([messageStep(proposalOutput(tightenProposal(24000)))]),
  });
  expect(result.outcomeCode).toBe("shadow_recorded");
  expect(result.validation?.resultKind).toBe("shadow_accepted");
  expect(result.activationAllowed).toBe(false);
  expect(result.executionModeOpened).toBe(false);
  expect(result.shadowDiff).toEqual([
    {
      field: "agents.defaults.contextTokens",
      ruleId: "model.context_window.guard",
      currentEffectiveValue: 32000,
      proposedValue: 24000,
      comparison: "tighten",
    },
  ]);
});

it("treats fixture: true as a marker, not a credential that would allow activation", async () => {
  const { host } = fixtureHost(
    limitedPersonalView({
      hostFacts: {
        fixture: true,
        identity: {
          principalType: "personal",
          principalId: "user:fixture-1",
          scope: { type: "personal", id: "agent:fixture-personal-1" },
        },
        currentEffectiveValues: { "agents.defaults.contextTokens": 32000 },
        authorizationStatus: "unauthorized",
        compatibilityRecord: {
          status: "approved_compatible",
          boundImplementationVersion: "9b65109f41dee30b892a6faff493e46e735cab8d",
          boundExpectedPolicyVersion: {
            policyHash: "fixture-policy-hash-aaaa",
            protocolVersion: "1.1",
            compilerRevision: "1.2.0",
          },
        },
        expectedPolicyState: "active",
      },
    }),
  );
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([messageStep(proposalOutput(tightenProposal(24000)))]),
  });
  expect(result.validation?.authorizationAssessment).toBe("host_unauthorized");
  expect(result.activationAllowed).toBe(false);
  expect(result.outcomeCode).toBe("shadow_recorded");
});
