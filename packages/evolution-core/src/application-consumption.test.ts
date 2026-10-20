import { describe, expect, it } from "vitest";
import {
  drillKillSwitchDenial,
  drillMissingRollbackDenial,
  evaluateControlPlaneApplicationConsumption,
  evaluateCutoverReadiness,
  CONSUMPTION_DENY_REASONS,
  hashConsumptionCandidatePayload,
  type ConsumptionObservation,
  type ControlPlaneConsumptionBinding,
  type RuntimeConsumptionIntent,
  type SkillConsumptionIntent,
  type StoredConsumptionCandidate,
} from "./application-consumption.js";
import type { AuthorityGrantView } from "./contracts.js";
import type { EvolutionApplication, EvolutionExperiment, EvolutionProposal } from "./types.js";

const NOW = "2026-09-22T00:00:00.000Z";

function grant(over: Partial<AuthorityGrantView> = {}): AuthorityGrantView {
  return {
    grantId: "grant-1",
    status: "APPROVED",
    tenantScope: "tenant-a",
    allowedEvidence: ["ev-a"],
    allowedActions: ["pause", "install"],
    confidentialityCeiling: "enterprise",
    ...over,
  };
}

function proposal(over: Partial<EvolutionProposal> = {}): EvolutionProposal {
  return {
    schemaVersion: 2,
    proposalId: "evo:rt",
    sourceEvidenceRefs: ["ev-a"],
    sourceMechanismRef: "case-a",
    target: { domain: "system", componentId: "bot-a" },
    candidateRef: "cand:v2",
    surfaceId: "system.runtime-binding-governance",
    expectedEffects: [],
    riskLevel: "critical",
    confidentialityScope: "platform",
    tenantScope: "tenant-a",
    grantId: "grant-1",
    status: "APPROVED_FOR_APPLICATION",
    createdAt: NOW,
    expiresAt: "2026-09-23T00:00:00.000Z",
    experimentId: "exp:rt",
    applicationId: "app:rt",
    ...over,
  };
}

function experiment(over: Partial<EvolutionExperiment> = {}): EvolutionExperiment {
  return {
    schemaVersion: 1,
    experimentId: "exp:rt",
    proposalId: "evo:rt",
    surfaceId: "system.runtime-binding-governance",
    target: { domain: "system", componentId: "bot-a" },
    tenantScope: "tenant-a",
    baselineRef: "base-v1",
    candidateRef: "cand:v2",
    configRef: "cfg",
    assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
    primaryMetric: {
      metricId: "health",
      kind: "primary",
      improveWhen: "increase",
      minimumEffect: 0,
    },
    guardrailMetrics: [],
    minimumSampleSize: 1,
    requiredConfidence: 0.9,
    expiresAt: "2026-09-23T00:00:00.000Z",
    result: "improved",
    frozen: {
      baselineVersion: "base-v1",
      candidateVersion: "cand:v2",
      codeSha: "sha",
      modelRef: "model",
      providerVersion: "p1",
      configSnapshotRef: "cfg",
      datasetOrCohortRef: "cohort",
      tenantScope: "tenant-a",
      confidentialityScope: "platform",
      expiresAt: "2026-09-23T00:00:00.000Z",
      maxResourceBudget: 1,
    },
    ...over,
  };
}

function application(over: Partial<EvolutionApplication> = {}): EvolutionApplication {
  return {
    schemaVersion: 1,
    applicationId: "app:rt",
    proposalId: "evo:rt",
    experimentId: "exp:rt",
    adapterId: "runtime-governance",
    idempotencyKey: "pause:bot-a",
    targetVersionBefore: "base-v1",
    targetVersionAfter: "cand:v2",
    rollbackRef: "rollback:pause:bot-a",
    scope: "canary",
    status: "pending",
    appliedToRuntime: false,
    ...over,
  };
}

function runtimeIntent(over: Partial<RuntimeConsumptionIntent> = {}): RuntimeConsumptionIntent {
  return {
    kind: "runtime-action",
    surfaceId: "system.runtime-binding-governance",
    adapterId: "runtime-governance",
    runtimeAgentId: "bot-a",
    action: "pause",
    approvedAction: "pause",
    candidateVersion: "cand:v2",
    tenantScope: "tenant-a",
    ...over,
  };
}

function stored(
  payload: Record<string, unknown>,
  candidateRef = "cand:v2",
): StoredConsumptionCandidate {
  return {
    candidateRef,
    version: candidateRef,
    payloadHash: hashConsumptionCandidatePayload(payload),
    payload,
  };
}

const RUNTIME_PAYLOAD = {
  action: "pause",
  runtimeAgentId: "bot-a",
  candidateVersion: "cand:v2",
};

const FORGED_AUTO_POLICY = {
  surfaceId: "system.runtime-binding-governance",
  mode: "auto" as const,
  maxApplications: 10,
  usedApplications: 0,
  maxImpactScope: "active" as const,
};

function binding(
  over: Partial<ControlPlaneConsumptionBinding> = {},
): ControlPlaneConsumptionBinding {
  return {
    proposal: proposal(),
    experiment: experiment(),
    application: application(),
    grant: grant(),
    storedCandidate: stored(RUNTIME_PAYLOAD),
    trustedTenantId: "tenant-a",
    mode: "auto",
    killSwitch: false,
    now: NOW,
    autonomyPolicy: FORGED_AUTO_POLICY,
    rollbackAvailable: true,
    idempotencyKey: "pause:bot-a",
    priorConsumption: null,
    intent: runtimeIntent(),
    ...over,
  };
}

function skillIntent(over: Partial<SkillConsumptionIntent> = {}): SkillConsumptionIntent {
  return {
    kind: "skill-install",
    surfaceId: "capability.skill-installation",
    adapterId: "skill-installation",
    agentId: "bot-a",
    skillId: "skill-1",
    version: "cand:v2",
    approvedAction: "install",
    candidateVersion: "cand:v2",
    autoInstallIntent: true,
    approvalAuditRef: "audit:1",
    tenantScope: "tenant-a",
    ...over,
  };
}

function skillBinding(
  over: Partial<ControlPlaneConsumptionBinding> = {},
): ControlPlaneConsumptionBinding {
  return binding({
    proposal: proposal({
      proposalId: "evo:sk",
      surfaceId: "capability.skill-installation",
      target: { domain: "capability", skillId: "skill-1" },
      experimentId: "exp:sk",
      applicationId: "app:sk",
      riskLevel: "high",
      confidentialityScope: "enterprise",
    }),
    experiment: experiment({
      experimentId: "exp:sk",
      proposalId: "evo:sk",
      surfaceId: "capability.skill-installation",
      target: { domain: "capability", skillId: "skill-1" },
      assignment: { strategy: "canary", treatmentRefs: ["t"], controlRefs: ["c"] },
    }),
    application: application({
      applicationId: "app:sk",
      proposalId: "evo:sk",
      experimentId: "exp:sk",
      adapterId: "skill-installation",
      idempotencyKey: "install:skill-1",
      rollbackRef: "rollback:install:skill-1",
    }),
    idempotencyKey: "install:skill-1",
    storedCandidate: stored({
      skillId: "skill-1",
      agentId: "bot-a",
      version: "cand:v2",
      candidateVersion: "cand:v2",
      operation: "install",
      autoInstallIntent: true,
      approvalAuditRef: "audit:1",
    }),
    autonomyPolicy: {
      surfaceId: "capability.skill-installation",
      mode: "auto",
      maxApplications: 10,
      usedApplications: 0,
      maxImpactScope: "active",
    },
    intent: skillIntent(),
    ...over,
  });
}

function observation(
  row: ReturnType<typeof evaluateControlPlaneApplicationConsumption>,
  recordedAt = NOW,
): ConsumptionObservation {
  return { ...row, recordedAt, directIntentPresent: true };
}

describe("control-plane application consumption", () => {
  it("does not treat a forged auto policy as surface autonomy approval", () => {
    const decision = evaluateControlPlaneApplicationConsumption(binding());
    expect(decision.wouldConsume).toBe(false);
    expect(decision.outcome).toBe("denied");
    expect(decision.denyReason).toBe("autonomy_not_approved");
    expect(decision.executedConsumer).toBe(false);
    expect(decision.contractChecks.grantActions).toBe(true);
    expect(decision.contractChecks.expiry).toBe(true);
    expect(decision.contractChecks.candidateStore).toBe(true);
    expect(decision.contractChecks.surfacePolicy).toBe(false);
  });

  it("denies skill installation when the registered surface cannot auto-apply", () => {
    const decision = evaluateControlPlaneApplicationConsumption(skillBinding());
    expect(decision.wouldConsume).toBe(false);
    expect(decision.denyReason).toBe("autonomy_not_approved");
    expect(decision.surfaceId).toBe("capability.skill-installation");
    expect(decision.executedConsumer).toBe(false);
    expect(decision.contractChecks.candidateStore).toBe(true);
  });

  it("denies a missing proposal, experiment, or application", () => {
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ proposal: null, experiment: null, application: null }),
      ).denyReason,
    ).toBe("missing_application");
    expect(evaluateControlPlaneApplicationConsumption(binding({ proposal: null })).denyReason).toBe(
      "missing_proposal",
    );
    expect(
      evaluateControlPlaneApplicationConsumption(binding({ experiment: null })).denyReason,
    ).toBe("missing_experiment");
    expect(
      evaluateControlPlaneApplicationConsumption(binding({ application: null })).denyReason,
    ).toBe("missing_application");
  });

  it("denies an application that has not passed the apply gate", () => {
    const decision = evaluateControlPlaneApplicationConsumption(
      binding({ proposal: proposal({ status: "EXPERIMENTING" }) }),
    );
    expect(decision.wouldConsume).toBe(false);
    expect(decision.denyReason).toBe("application_not_approved");
  });

  it("denies target, tenant, and action mismatches", () => {
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ intent: runtimeIntent({ runtimeAgentId: "bot-b" }) }),
      ).denyReason,
    ).toBe("target_mismatch");
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ intent: runtimeIntent({ tenantScope: "tenant-b" }) }),
      ).denyReason,
    ).toBe("cross_tenant");
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({
          grant: grant({ tenantScope: "tenant-b" }),
        }),
      ).denyReason,
    ).toBe("tenant_mismatch");
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ intent: runtimeIntent({ approvedAction: "resume" }) }),
      ).denyReason,
    ).toBe("action_mismatch");
  });

  it("denies an expired or revoked grant", () => {
    expect(
      evaluateControlPlaneApplicationConsumption(binding({ grant: grant({ expired: true }) }))
        .denyReason,
    ).toBe("grant_expired");
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ grant: grant({ revoked: true, status: "REVOKED" }) }),
      ).denyReason,
    ).toBe("grant_revoked");
    expect(evaluateControlPlaneApplicationConsumption(binding({ grant: null })).denyReason).toBe(
      "grant_missing",
    );
  });

  it("fails closed on kill switch and assist, with zero executed consumer", () => {
    const killed = evaluateControlPlaneApplicationConsumption(binding({ killSwitch: true }));
    expect(killed.wouldConsume).toBe(false);
    expect(killed.denyReason).toBe("kill_switch");
    expect(killed.executedConsumer).toBe(false);
    const assist = evaluateControlPlaneApplicationConsumption(binding({ mode: "assist" }));
    expect(assist.wouldConsume).toBe(false);
    expect(assist.denyReason).toBe("assist_zero_mutation");
    expect(assist.executedConsumer).toBe(false);
  });

  it("does not let command replay bypass surface policy, and rejects a second key", () => {
    const replay = evaluateControlPlaneApplicationConsumption(
      binding({
        application: application({ status: "applied", appliedAt: NOW }),
        priorConsumption: {
          applicationId: "app:rt",
          idempotencyKey: "pause:bot-a",
          consumedAt: NOW,
        },
      }),
    );
    expect(replay.wouldConsume).toBe(false);
    expect(replay.denyReason).toBe("autonomy_not_approved");
    expect(replay.executedConsumer).toBe(false);
    const duplicate = evaluateControlPlaneApplicationConsumption(
      binding({
        priorConsumption: {
          applicationId: "app:rt",
          idempotencyKey: "pause:other",
          consumedAt: NOW,
        },
      }),
    );
    expect(duplicate.wouldConsume).toBe(false);
    expect(duplicate.denyReason).toBe("duplicate_consumption");
  });

  it("denies a missing rollback ref", () => {
    const decision = evaluateControlPlaneApplicationConsumption(
      binding({ rollbackAvailable: false }),
    );
    expect(decision.wouldConsume).toBe(false);
    expect(decision.denyReason).toBe("rollback_missing");
  });

  it("keeps cutoverReady false unless the whole readiness window is clean", () => {
    const closed = evaluateCutoverReadiness({
      observations: [],
      killSwitchDrillPassed: false,
      rollbackDrillPassed: false,
      idempotentReplayPassed: false,
      assistZeroMutation: true,
    });
    expect(closed.cutoverReady).toBe(false);
    const orphan = observation(
      evaluateControlPlaneApplicationConsumption(binding({ application: null })),
    );
    expect(
      evaluateCutoverReadiness({
        observations: [orphan],
        killSwitchDrillPassed: true,
        rollbackDrillPassed: true,
        idempotentReplayPassed: true,
        assistZeroMutation: true,
      }).cutoverReady,
    ).toBe(false);
    const matched = observation(evaluateControlPlaneApplicationConsumption(binding()));
    const deniedWindow = evaluateCutoverReadiness({
      observations: [matched],
      killSwitchDrillPassed: true,
      rollbackDrillPassed: true,
      idempotentReplayPassed: true,
      assistZeroMutation: true,
    });
    expect(deniedWindow.matchedApplications).toBe(0);
    expect(deniedWindow.denyCounts.autonomy_not_approved).toBe(1);
    expect(deniedWindow.unresolvedDenials).toBe(1);
    expect(deniedWindow.cutoverReady).toBe(false);
    expect(deniedWindow.e52SwitchAllowed).toBe(false);
    const hidden = evaluateCutoverReadiness({
      observations: [
        observation(evaluateControlPlaneApplicationConsumption(binding({ storedCandidate: null }))),
        observation(
          evaluateControlPlaneApplicationConsumption(
            binding({ experiment: experiment({ proposalId: "evo:other" }) }),
          ),
        ),
        observation(
          evaluateControlPlaneApplicationConsumption(
            binding({
              proposal: proposal({ surfaceId: "capability.skill-installation" }),
            }),
          ),
        ),
      ],
      killSwitchDrillPassed: true,
      rollbackDrillPassed: true,
      idempotentReplayPassed: true,
      assistZeroMutation: true,
    });
    expect(hidden.targetMismatch).toBe(0);
    expect(hidden.tenantMismatch).toBe(0);
    expect(hidden.actionMismatch).toBe(0);
    expect(hidden.denyCounts.candidate_mismatch).toBe(1);
    expect(hidden.denyCounts.binding_mismatch).toBe(1);
    expect(hidden.denyCounts.surface_mismatch).toBe(1);
    expect(hidden.unresolvedDenials).toBe(3);
    expect(hidden.cutoverReady).toBe(false);
    expect(hidden.e52SwitchAllowed).toBe(false);
    const forged = observation(evaluateControlPlaneApplicationConsumption(binding()));
    forged.wouldConsume = true;
    forged.outcome = "would_consume";
    forged.denyReason = null;
    const forgedReady = evaluateCutoverReadiness({
      observations: [forged],
      killSwitchDrillPassed: true,
      rollbackDrillPassed: true,
      idempotentReplayPassed: true,
      assistZeroMutation: true,
    });
    expect(forgedReady.cutoverReady).toBe(false);
    expect(forgedReady.e52SwitchAllowed).toBe(false);
  });

  it("checks grant actions, expiry, and the candidate store payload", () => {
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ grant: grant({ allowedActions: ["observe"] }) }),
      ).denyReason,
    ).toBe("grant_action_forbidden");
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ proposal: proposal({ expiresAt: NOW }) }),
      ).denyReason,
    ).toBe("proposal_expired");
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ experiment: experiment({ expiresAt: NOW }) }),
      ).denyReason,
    ).toBe("experiment_expired");
    expect(
      evaluateControlPlaneApplicationConsumption(binding({ now: "not-a-clock" })).denyReason,
    ).toBe("proposal_expired");
    const tampered = stored(RUNTIME_PAYLOAD);
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({ storedCandidate: { ...tampered, payloadHash: "deadbeef" } }),
      ).denyReason,
    ).toBe("candidate_mismatch");
    expect(
      evaluateControlPlaneApplicationConsumption(
        binding({
          storedCandidate: stored({ ...RUNTIME_PAYLOAD, action: "resume" }),
        }),
      ).denyReason,
    ).toBe("candidate_mismatch");
  });

  it("drills kill switch and missing rollback without executing", () => {
    expect(drillKillSwitchDenial(binding()).passed).toBe(true);
    expect(drillMissingRollbackDenial(binding()).passed).toBe(true);
    expect(drillKillSwitchDenial(binding()).denyReason).toBe("kill_switch");
  });

  it("counts every deny reason and refuses a damaged or empty store", () => {
    const template = observation(evaluateControlPlaneApplicationConsumption(binding()));
    template.contractChecks = {
      grantActions: true,
      expiry: true,
      candidateStore: true,
      surfacePolicy: true,
    };
    template.wouldConsume = false;
    template.outcome = "denied";
    template.executedConsumer = false;
    const observations = CONSUMPTION_DENY_REASONS.map((reason, index) =>
      observation(
        { ...template, denyReason: reason },
        `2026-09-22T00:${String(index).padStart(2, "0")}:00.000Z`,
      ),
    );
    const denied = evaluateCutoverReadiness({
      observations,
      killSwitchDrillPassed: true,
      rollbackDrillPassed: true,
      idempotentReplayPassed: true,
      assistZeroMutation: true,
      directMutatorsRetired: true,
    });
    for (const reason of CONSUMPTION_DENY_REASONS) {
      expect(denied.denyCounts[reason]).toBe(1);
    }
    expect(denied.unresolvedDenials).toBe(CONSUMPTION_DENY_REASONS.length);
    expect(denied.cutoverReady).toBe(false);
    expect(denied.e52SwitchAllowed).toBe(false);
    const empty = evaluateCutoverReadiness({
      observations: [],
      killSwitchDrillPassed: true,
      rollbackDrillPassed: true,
      idempotentReplayPassed: true,
      assistZeroMutation: true,
      directMutatorsRetired: true,
    });
    expect(empty.observationStoreHealthy).toBe(true);
    expect(empty.shadowObservationWindow.sampleCount).toBe(0);
    expect(empty.cutoverReady).toBe(false);
    const damaged = evaluateCutoverReadiness({
      observations: [],
      killSwitchDrillPassed: true,
      rollbackDrillPassed: true,
      idempotentReplayPassed: true,
      assistZeroMutation: true,
      directMutatorsRetired: true,
      store: {
        observationStoreHealthy: false,
        corruptionCount: 1,
        unsupportedSchemaCount: 1,
        truncated: true,
        persistenceFailure: true,
      },
    });
    expect(damaged.observationStoreHealthy).toBe(false);
    expect(damaged.corruptionCount).toBe(1);
    expect(damaged.persistenceFailure).toBe(true);
    expect(damaged.cutoverReady).toBe(false);
    expect(damaged.e52SwitchAllowed).toBe(false);
    const ready = evaluateCutoverReadiness({
      observations: [
        observation(
          {
            ...template,
            denyReason: null,
            outcome: "would_consume",
            wouldConsume: true,
          },
          "2026-09-22T00:40:00.000Z",
        ),
      ],
      killSwitchDrillPassed: true,
      rollbackDrillPassed: true,
      idempotentReplayPassed: true,
      assistZeroMutation: true,
      directMutatorsRetired: false,
    });
    expect(ready.cutoverReady).toBe(true);
    expect(ready.e52SwitchAllowed).toBe(false);
  });
});
