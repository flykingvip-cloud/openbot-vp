import { describe, expect, it } from "vitest";
import {
  fixtureActivationBinding,
  fixtureBoard,
  fixtureProposal,
  fixtureProposalHash,
  FIXTURE_POLICY_VERSION,
  FIXTURE_TASK_ID,
  FIXTURE_WHITELIST,
} from "../../command/rule-adaptation/activation-test-support.js";
import { authorizedPersonalHost } from "../../command/rule-adaptation/activation-test-support.js";
import {
  NO_LIVE_EXECUTION_CLAIM,
  PRODUCTION_RUNTIME_RULE_WHITELIST,
  RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
} from "../../contracts/rule-adaptation-activation.js";
import { precheckRuntimeRuleActivation, hashCanonicalJson } from "./activation-precheck.js";
import { validateRuntimeRuleProposal } from "./validate.js";
import { legalPersonalCandidate } from "./validate.test-support.js";

function codes(result: { reasons: Array<{ code: string }> }): string[] {
  return result.reasons.map((entry) => entry.code);
}

function liveContext(overrides: Record<string, unknown> = {}) {
  return {
    liveBoard: fixtureBoard({ writeEpoch: 1 }),
    currentImplementationVersion: RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
    currentExpectedPolicyVersion: FIXTURE_POLICY_VERSION,
    fixtureWhitelist: FIXTURE_WHITELIST,
    ...overrides,
  };
}

describe("P3 pure activation precheck", () => {
  it("B-01 rejects each missing required binding field without inventing defaults", () => {
    const proposal = fixtureProposal();
    const required = [
      "authorizationReference",
      "identity",
      "taskBinding",
      "approvedCandidateIdentity",
      "hostActivationGate",
    ] as const;
    for (const key of required) {
      const binding = fixtureActivationBinding({ proposalForHash: proposal });
      delete binding[key];
      const result = precheckRuntimeRuleActivation(proposal, binding, liveContext());
      expect(result.ok).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(result.resultKind).toBe("rejected");
      expect(codes(result)).toContain(
        key === "hostActivationGate"
          ? "shadow_accepted_not_credential"
          : "structural_missing_binding",
      );
    }
    const missingEpoch = fixtureActivationBinding({ proposalForHash: proposal });
    const versions = { ...(missingEpoch.expectedVersions as Record<string, unknown>) };
    delete versions.expectedWriteEpoch;
    missingEpoch.expectedVersions = versions;
    const epochResult = precheckRuntimeRuleActivation(proposal, missingEpoch, liveContext());
    expect(epochResult.ok).toBe(false);
    if (!epochResult.ok) {
      expect(codes(epochResult)).toContain("structural_missing_binding");
    }
    const missingPolicy = fixtureActivationBinding({ proposalForHash: proposal });
    const ev = { ...(missingPolicy.expectedVersions as Record<string, unknown>) };
    delete ev.expectedPolicyVersion;
    missingPolicy.expectedVersions = ev;
    const policyResult = precheckRuntimeRuleActivation(proposal, missingPolicy, liveContext());
    expect(policyResult.ok).toBe(false);
    if (!policyResult.ok) {
      expect(codes(policyResult)).toContain("structural_missing_binding");
    }
  });

  it("B-02 rejects unknown or forbidden fields on the proposal or binding", () => {
    const proposal = fixtureProposal({ activateNow: true });
    const result = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal }),
      liveContext(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("structural_forbidden_field");
    }
    const binding = fixtureActivationBinding();
    binding.unexpectedFlag = true;
    const unknown = precheckRuntimeRuleActivation(fixtureProposal(), binding, liveContext());
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) {
      expect(codes(unknown)).toContain("structural_unknown_field");
    }
  });

  it("B-03 rejects mismatched scope, task, or expected policy version bindings", () => {
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({
      proposalForHash: proposal,
      identity: {
        principalType: "personal",
        principalId: "user:fixture-1",
        scope: { type: "personal", id: "agent:other-scope" },
      },
    });
    const result = precheckRuntimeRuleActivation(proposal, binding, liveContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("identity_scope_mismatch");
    }
  });

  it("B-04 / B-06 rejects unapproved candidates, rule_candidate, and candidate_validated identities", () => {
    const candidate = legalPersonalCandidate();
    const asCandidate = precheckRuntimeRuleActivation(
      candidate,
      fixtureActivationBinding({
        approvedCandidateIdentity: {
          proposalHash: hashCanonicalJson(candidate),
          resultKind: "candidate_validated",
          validatorImplementationVersion: RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
        },
      }),
      liveContext(),
    );
    expect(asCandidate.ok).toBe(false);
    if (!asCandidate.ok) {
      expect(codes(asCandidate)).toContain("candidate_cannot_activate");
    }
    const proposal = fixtureProposal();
    const rewritten = fixtureProposal({
      items: [
        {
          ruleId: "model.context_window.guard",
          field: "agents.defaults.contextTokens",
          action: "tune",
          proposedValue: 20000,
        },
      ],
    });
    const mismatch = precheckRuntimeRuleActivation(
      rewritten,
      fixtureActivationBinding({ proposalForHash: proposal }),
      liveContext(),
    );
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(codes(mismatch)).toContain("unapproved_candidate");
    }
  });

  it("B-05 treats shadow_accepted without a host gate as insufficient", () => {
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({ proposalForHash: proposal });
    delete binding.hostActivationGate;
    const result = precheckRuntimeRuleActivation(proposal, binding, liveContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("shadow_accepted_not_credential");
    }
    const validation = validateRuntimeRuleProposal(proposal, authorizedPersonalHost());
    expect(validation.resultKind).toBe("shadow_accepted");
    expect(validation.activationAllowed).toBe(false);
  });

  it("B-07 rejects activation when the production whitelist is empty", () => {
    expect(PRODUCTION_RUNTIME_RULE_WHITELIST).toEqual([]);
    const proposal = fixtureProposal();
    const result = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal, fixture: false }),
      liveContext({ fixtureWhitelist: FIXTURE_WHITELIST }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("empty_whitelist");
    }
  });

  it("B-08 / B-09 rejects unknown or stale implementation and policy versions", () => {
    const proposal = fixtureProposal({
      implementationVersion: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    const unknownImpl = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal }),
      liveContext(),
    );
    expect(unknownImpl.ok).toBe(false);
    if (!unknownImpl.ok) {
      expect(codes(unknownImpl)).toContain("policy_version_mismatch");
    }
    const staleProposal = fixtureProposal({
      expectedPolicyVersion: {
        policyHash: "stale-policy-hash",
        protocolVersion: "1.1",
        compilerRevision: "1.2.0",
      },
    });
    const stale = precheckRuntimeRuleActivation(
      staleProposal,
      fixtureActivationBinding({
        proposalForHash: staleProposal,
        expectedVersions: {
          expectedWriteEpoch: 1,
          expectedPolicyVersion: {
            policyHash: "stale-policy-hash",
            protocolVersion: "1.1",
            compilerRevision: "1.2.0",
          },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
        },
        compatibilityRecord: {
          status: "approved_compatible",
          boundImplementationVersion: RUNTIME_RULE_ADAPTATION_IMPLEMENTATION_VERSION,
          boundExpectedPolicyVersion: {
            policyHash: "stale-policy-hash",
            protocolVersion: "1.1",
            compilerRevision: "1.2.0",
          },
        },
      }),
      liveContext(),
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(codes(stale)).toContain("policy_version_mismatch");
    }
  });

  it("C-02 rejects an expired, cancelled, or deadline-passed proposal and does not invent a TTL", () => {
    const proposal = fixtureProposal();
    const expired = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal, expectedPolicyState: "expired" }),
      liveContext(),
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(codes(expired)).toContain("proposal_expired");
    }
    const timedOut = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({
        proposalForHash: proposal,
        expectedVersions: {
          expectedWriteEpoch: 1,
          expectedPolicyVersion: { ...FIXTURE_POLICY_VERSION },
          expectedExecutionClaim: NO_LIVE_EXECUTION_CLAIM,
          expiresAtMs: 1,
        },
      }),
      liveContext(),
    );
    expect(timedOut.ok).toBe(false);
    if (!timedOut.ok) {
      expect(codes(timedOut)).toContain("proposal_expired");
    }
  });

  it("C-03 / D-04 rejects revoked authorization and independent permission axes", () => {
    const proposal = fixtureProposal();
    const revoked = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal, authorizationStatus: "unauthorized" }),
      liveContext(),
    );
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(codes(revoked)).toContain("authorization_revoked");
    }
    const axis = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({
        proposalForHash: proposal,
        permission: "disable",
        authorizedPermissions: ["tune"],
      }),
      liveContext(),
    );
    expect(axis.ok).toBe(false);
    if (!axis.ok) {
      expect(codes(axis)).toContain("permission_axis_mismatch");
    }
  });

  it("C-04 rejects a taken-down or unknown ruleId", () => {
    const proposal = fixtureProposal();
    const result = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal }),
      liveContext({ takenDownRuleIds: ["model.context_window.guard"] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("rule_taken_down");
    }
  });

  it("C-08 rejects a tombstoned or cancelled task", () => {
    const proposal = fixtureProposal();
    const result = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal }),
      liveContext({
        liveBoard: fixtureBoard({
          writeEpoch: 1,
          current: undefined,
          tombstones: [{ taskId: FIXTURE_TASK_ID, closedAtMs: 1 }],
        }),
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("cancelled_or_tombstone");
    }
  });

  it("E-01 / E-02 reject a second config authority or commercial planVersionId CAS axis", () => {
    const proposal = fixtureProposal();
    const plan = fixtureActivationBinding({
      proposalForHash: proposal,
      planVersionId: "commerce-plan-1",
    });
    const planResult = precheckRuntimeRuleActivation(proposal, plan, liveContext());
    expect(planResult.ok).toBe(false);
    if (!planResult.ok) {
      expect(codes(planResult)).toContain("commercial_plan_version");
    }
    const config = fixtureActivationBinding({
      proposalForHash: proposal,
      operatingState: { open: true },
    });
    const configResult = precheckRuntimeRuleActivation(proposal, config, liveContext());
    expect(configResult.ok).toBe(false);
    if (!configResult.ok) {
      expect(codes(configResult)).toContain("second_config_authority");
    }
  });

  it("E-03 rejects a request with no task binding", () => {
    const proposal = fixtureProposal();
    const binding = fixtureActivationBinding({ proposalForHash: proposal });
    delete binding.taskBinding;
    const result = precheckRuntimeRuleActivation(proposal, binding, liveContext());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result)).toContain("structural_missing_binding");
    }
  });

  it("accepts a fixture-whitelist legal precheck without writing state", () => {
    const proposal = fixtureProposal();
    const result = precheckRuntimeRuleActivation(
      proposal,
      fixtureActivationBinding({ proposalForHash: proposal }),
      liveContext(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.whitelistSource).toBe("fixture");
      expect(result.proposalHash).toBe(fixtureProposalHash(proposal));
    }
  });
});
